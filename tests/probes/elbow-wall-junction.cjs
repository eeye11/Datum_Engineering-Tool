/*
 * ========================================================
 * A GEOMETRY PROBE: WHERE THE PIPE WALLS AND THE BEND MEET
 * ========================================================
 *
 * Run it with
 *
 *     node tests/probes/elbow-wall-junction.cjs
 *
 * It builds the drawing the way a student does - two Pipe / Duct runs joined
 * by the tool - and measures, in world units, at BOTH junctions of the bend:
 *
 *   GAP    the distance from each elbow wall's end to the end of the straight
 *          wall it continues. Zero means the two lines meet.
 *   KINK   the angle between the elbow wall's tangent where it ends and the
 *          straight wall's direction it meets. Zero means they are tangent
 *          rather than meeting at a corner.
 *   BORE   the width across the bend where it meets each pipe, against the
 *          width that pipe is drawn at.
 *
 * TWO THINGS ABOUT THE MEASUREMENT, both of which have been got wrong before:
 *
 *   A JOINED RUN IS ALREADY SEATED ON ITS TANGENT POINT, so the runs are read
 *   exactly as they are stored. Trimming them again would shorten them a second
 *   time and measure a wall that is not on the sheet.
 *
 *   AN ARC'S TANGENT IS PERPENDICULAR TO ITS RADIUS, so the kink is measured
 *   from the radius rather than between two sampled points - sampling reports
 *   the chord's angle, which is off by half the sampling step.
 */
const path = require("path");

const { bootApp } = require("../helpers/boot-app.cjs");
const { locate } = require("../helpers/source-path.cjs");

let page = null;

function modules() {
  if (!page) {
    page = bootApp();

    if (page.error) {
      throw page.error;
    }
  }

  return {
    tool: require(locate("pipe-duct-tool.js")),
    pipe: require(locate("model/fluids/pipe-duct.js")).default,
    state: require(locate("editor-state.js")).drawingState
  };
}

const near = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

const angleBetween = (a, b) => {
  const scale = Math.hypot(a.x, a.y) * Math.hypot(b.x, b.y);

  if (scale < 1e-12) {
    return 90;
  }

  const cosine = Math.abs((a.x * b.x + a.y * b.y) / scale);

  return (Math.acos(Math.min(1, Math.max(0, cosine))) * 180) / Math.PI;
};

const directionOf = (from, to) => ({ x: to.x - from.x, y: to.y - from.y });

function reset(state) {
  state.objects = [];
  state.selection.selectedObjectIds = [];
  state.interaction.previousRun = null;
  state.interaction.routeCommittedCount = 0;
  state.interaction.phase = "idle";
}

function drawCorner(m, bendDegrees, { hostWidth = 0, branchWidth = 0 } = {}) {
  reset(m.state);

  const radians = (bendDegrees * Math.PI) / 180;

  const far = { x: 100 + 140 * Math.cos(radians), y: 140 * Math.sin(radians) };

  const host = m.pipe.createPipeDuct({ x: 0, y: 0 }, { x: 100, y: 0 });
  const branch = m.pipe.createPipeDuct(far, { x: 100, y: 0 });

  host.engineering = { ...(host.engineering || {}), separation: hostWidth || undefined };
  branch.engineering = { ...(branch.engineering || {}), separation: branchWidth || undefined };

  m.state.objects = [host, branch];

  m.tool.connectPipeEndpoints(branch);

  return {
    host: m.state.objects.find((object) => object.id === host.id),
    branch: m.state.objects.find((object) => object.id === branch.id),
    elbow: m.state.objects.find((object) => object.type === "elbow")
  };
}

/*
 * EVERY STRAIGHT WALL'S JUNCTION END, with the wall it belongs to. The junction
 * end is the one nearer the elbow's corner; the wall's direction is the same
 * either way.
 */
function junctionEnds(m, drawing) {
  const corner = drawing.elbow.geometry.position;

  return [drawing.host, drawing.branch].flatMap((run) =>
    m.pipe
      .boundaryLinesOf(run)
      .map((wall) => ({
        point: near(wall.start, corner) < near(wall.end, corner) ? wall.start : wall.end,
        direction: directionOf(wall.start, wall.end)
      }))
  );
}

function measure(m, drawing) {
  const { host, branch, elbow } = drawing;

  if (!elbow) {
    return null;
  }

  const walls = m.pipe.elbowWallArcsFor(elbow);

  if (!walls) {
    return null;
  }

  const ends = junctionEnds(m, drawing);

  /*
   * EACH ARC END IS MATCHED TO THE STRAIGHT WALL WHOSE END IS NEAREST IT, and the
   * kink is measured against THAT wall. Matching by index instead - "outer is
   * the left wall" - is wrong the moment the turn reverses, and the error shows
   * up as a kink of exactly the bend angle.
   */
  const match = (point) =>
    ends.reduce((best, candidate) => (!best || near(point, candidate.point) < near(point, best.point) ? candidate : best));

  const radiusAt = (wall, t) => {
    const point = wall.pointAt(t);

    return { x: point.x - walls.bend.centre.x, y: point.y - walls.bend.centre.y };
  };

  const arcs = [
    { point: walls.outer.start, radius: radiusAt(walls.outer, 0) },
    { point: walls.inner.start, radius: radiusAt(walls.inner, 0) },
    { point: walls.outer.end, radius: radiusAt(walls.outer, 1) },
    { point: walls.inner.end, radius: radiusAt(walls.inner, 1) }
  ];

  const matched = arcs.map((arc) => ({ arc, hit: match(arc.point) }));

  const gap = Math.max(...matched.map(({ arc, hit }) => near(arc.point, hit.point)));

  /*
   * A TANGENT IS 90 DEGREES OFF ITS RADIUS, so a wall meeting it square is zero
   * kink. The radius used is the arc's own, at the end being measured.
   */
  const kink = Math.max(
    ...matched.map(({ arc, hit }) => Math.abs(90 - angleBetween(arc.radius, hit.direction)))
  );

  const hostBore = m.pipe.boundarySeparation(host.engineering || {});
  const branchBore = m.pipe.boundarySeparation(branch.engineering || {});

  const bore = Math.max(
    Math.abs(walls.outer.startRadius - walls.inner.startRadius - hostBore),
    Math.abs(walls.outer.endRadius - walls.inner.endRadius - branchBore)
  );

  return { gap, kink, bore };
}

const TOLERANCE = { gap: 1e-9, kink: 1e-6, bore: 1e-9 };

let failures = 0;

function report(label, result) {
  if (!result) {
    console.log(`  FAIL ${label}: no drawable bend`);
    failures += 1;
    return;
  }

  const ok =
    result.gap <= TOLERANCE.gap && result.kink <= TOLERANCE.kink && result.bore <= TOLERANCE.bore;

  if (!ok) {
    failures += 1;
  }

  console.log(
    `  ${ok ? "ok  " : "FAIL"} ${label.padEnd(26)}` +
      ` gap ${result.gap.toExponential(2).padStart(9)}` +
      `  kink ${result.kink.toExponential(2).padStart(9)}` +
      `  bore ${result.bore.toExponential(2).padStart(9)}`
  );
}

const m = modules();

console.log(`\n${path.basename(__filename)}: the visible pipe walls against the bend\n`);

for (const angle of [30, 45, 60, 90, 120, 135, 22.5, 150]) {
  for (const direction of [1, -1]) {
    report(`${angle} deg ${direction > 0 ? "left " : "right"}`, measure(m, drawCorner(m, angle * direction)));
  }
}

for (const angle of [45, 90, 120]) {
  for (const [hostWidth, branchWidth] of [[4, 0], [0, 4], [4, 8]]) {
    report(
      `${angle} deg ${hostWidth || "default"}/${branchWidth || "default"}`,
      measure(m, drawCorner(m, angle, { hostWidth, branchWidth }))
    );
  }
}

for (const radius of [1, 2, 5, 12, 20]) {
  const drawing = drawCorner(m, 90);

  if (drawing.elbow) {
    m.pipe.setBendRadius(drawing.elbow, radius, { user: true });

    m.tool.reconcileFluidConnections(drawing.host);
  }

  report(`radius ${radius}`, measure(m, drawing));
}

{
  const drawing = drawCorner(m, 90);

  if (drawing.elbow) {
    const radians = (35 * Math.PI) / 180;

    drawing.branch.geometry.start = {
      x: 100 + 140 * Math.cos(radians),
      y: 140 * Math.sin(radians)
    };

    m.tool.reconcileFluidConnections(drawing.branch);
  }

  report("dragged 90 -> 35 deg", measure(m, drawing));
}

console.log(
  `\n${failures === 0 ? "every junction meets tangentially" : `${failures} junction(s) do not meet`}\n`
);

process.exit(failures === 0 ? 0 : 1);

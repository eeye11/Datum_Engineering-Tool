/*
 * ========================================================
 * DOES A VECTOR POINT WHERE IT POINTS?
 * ========================================================
 *
 * Statics vectors - a Point Force, a Resultant, the three vectors of a Force
 * Components - were drawn by two separate routines. One took two points and
 * measured the difference. The other took an ANGLE and rebuilt the tip:
 *
 *     y: anchor.y - Math.sin(radians) * length
 *
 * That leading minus is wrong: `anchor` is a screen point, screen y grows
 * downward, and by the time a point is being placed the inversion has
 * already happened inside the projection. The caller compensated by handing
 * in a negated angle, so the two errors cancelled and the drawing happened
 * to be right.
 *
 * Two wrongs in one place is not a working arrangement. It cannot be
 * changed, cannot be reused for a new vector type, and cannot be reasoned
 * about without first working out which of the two signs is wrong in a
 * given quadrant. The shared arrow now takes the two points and measures
 * its own direction, so there is no sign left to get wrong.
 *
 * The test renders real forces through the real renderer and asks the only
 * question that matters: does the arrowhead sit on the side of the
 * application point the engineering vector says it should?
 */
const path = require("path");
const { JSDOM } = require("jsdom");

const projectRoot = path.join(__dirname, "..");

let pass = 0;
let fail = 0;

const check = (name, ok, detail) => {
  if (ok) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(
      `  FAIL ${name}${detail ? `\n       ${detail}` : ""}`,
    );
  }
};

/*
 * THE APPLICATION MODULES ARE LOADED BY THE SHARED HARNESS.
 *
 * This file used to list them itself, and the list was missing
 * `load-profile.js` - so the renderer's very first force threw
 * "enggLoadProfile is not defined" and the arrows were never drawn. The error
 * was wrapped in a try/catch at the top of this file, so it printed and the
 * run carried on, and the result was a test file about arrowheads that never
 * drew an arrowhead.
 *
 * The harness keeps one list of what the renderer reaches for, so a module
 * added there is added here.
 */
const { createHarness } = require("./support/harness-renderer.cjs");

const { dom, canvas } = createHarness(
  projectRoot,
  JSDOM,
  require,
);

const renderer = global.window.enggDrawingRenderer;

const base = {
  selection: {
    selectedObjectIds: [],
    boxSelectionIds: [],
    hoveredObjectId: null,
  },
  interaction: {
    phase: "idle",
    preview: null,
    previewObjects: [],
    hoveredEntity: null,
    snapCandidate: null,
  },
  camera: { zoom: 1, panX: 0, panY: 0 },
  styleDefaults: { stroke: "#000000", lineWidth: 0.5 },
  grid: { visible: false, spacing: 10 },
  snap: { enabled: false },
};

/*
 * A force at the origin of the sheet, drawn and read back.
 *
 * The arrowhead is the FILLED POLYGON, and its tip is the vertex that is
 * furthest from the tail - that is what "points in this direction" means
 * geometrically, and it is checked rather than assumed.
 */
function drawnForce(force) {
  renderer.renderDrawing(
    { ...base, objects: [force] },
    canvas,
  );

  const group = canvas.querySelector(
    ".drawing-feature",
  );

  if (!group) {
    return null;
  }

  const line = group.querySelector("line");

  const heads = [...group.querySelectorAll("polygon")];

  if (!line || !heads.length) {
    return null;
  }

  const tail = {
    x: Number(line.getAttribute("x1")),
    y: Number(line.getAttribute("y1")),
  };

  /*
   * THE TIP, IDENTIFIED RATHER THAN GUESSED.
   *
   * `appendArrowHead` builds the head as [tip, baseCorner, baseCorner], so
   * the tip is the first vertex - and it is also the one that coincides
   * with the shaft's far end.
   *
   * It must not be found by taking "the vertex furthest from the tail":
   * the two BASE corners of a head extend slightly further from the tail
   * than the tip does, because the head flares back from the tip. For a
   * vertical arrow those corners are the higher points on the sheet, and
   * the heuristic picks one of them - which reads as an arrow pointing
   * 45 degrees off when it is pointing perfectly straight up.
   */
  const shaftEnd = {
    x: Number(line.getAttribute("x2")),
    y: Number(line.getAttribute("y2")),
  };

  const points = heads[0]
    .getAttribute("points")
    .trim()
    .split(/\s+/)
    .map(pair => {
      const [x, y] = pair.split(",").map(Number);

      return { x, y };
    });

  const tip = points.reduce((best, point) =>
    Math.hypot(point.x - shaftEnd.x, point.y - shaftEnd.y) <
    Math.hypot(best.x - shaftEnd.x, best.y - shaftEnd.y)
      ? point
      : best,
  );

  check(
    "the arrowhead tip sits on the shaft's far end",
    Math.hypot(tip.x - shaftEnd.x, tip.y - shaftEnd.y) < 1e-6,
    `tip ${JSON.stringify(tip)} vs shaft end ${JSON.stringify(shaftEnd)}`,
  );

  return { tail, tip, screen: { dx: tip.x - tail.x, dy: tip.y - tail.y } };
}

/*
 * A FORCE, WITH THE ANGLE ITS ENDPOINTS IMPLY.
 *
 * A real force always carries both: `setForceVector` writes the angle, the
 * components and the endpoints together, and the panel edits the angle through
 * that same function. This helper used to write only `end`, which is not a
 * state the application can produce - and once the renderer began drawing the
 * arrow ALONG the span, a hand-built force whose angle pointed somewhere the
 * span did not was a shape with no drawing that could satisfy it.
 *
 * The endpoints are therefore built from the angle, so every case is a force
 * the application could have created.
 */
const cleanAxis = (value) => (Math.abs(value) < 1e-9 ? 0 : value);

const forceAt = (extra) => {
  /*
   * THE ENDPOINTS FOLLOW FROM THE ANGLE, NOT THE OTHER WAY ROUND.
   *
   * A force is drawn ALONG its span, with the arrowhead at one end of it or the
   * other according to which way it pushes. So the angle and the endpoints are
   * two descriptions of the same line and cannot be chosen independently: a
   * span from (0,0) to (100,0) with an angle of 90 is not a force pointing up,
   * it is a force pointing along the x-axis whose stored direction says
   * otherwise.
   *
   * The old helper took its endpoints from the caller and its angle from those
   * endpoints, so any case that stated an angle of its own - "a force at 90
   * degrees" - left the two contradicting each other, and the renderer was then
   * asked to draw a force whose parts disagreed. Every quadrant case below
   * builds the span FROM the angle it is testing, which is the shape
   * `setForceVector` actually writes.
   */
  const start = { x: 0, y: 0 };

  const angle = Number(
    extra && extra.angle !== undefined ? extra.angle : 0
  );

  const length =
    extra && extra.magnitude !== undefined
      ? Number(extra.magnitude)
      : Math.hypot(extra?.end?.x ?? 100, extra?.end?.y ?? 0);

  const radians = (angle * Math.PI) / 180;

  const end =
    extra && extra.end
      ? { x: extra.end.x, y: extra.end.y }
      : {
            x: cleanAxis(start.x + Math.cos(radians) * length),
            y: cleanAxis(start.y + Math.sin(radians) * length),
        };

  /*
   * THE AXIS CASES ARE EXACT, NOT MERELY CLOSE.
   *
   * `Math.cos(90 * Math.PI / 180)` is 6.1e-17, not 0, so a span built for a
   * force pointing up comes out with a hair of east in it. That is far too
   * small to see and quite enough to fail an exact direction check - and worse,
   * it decides which END the arrowhead goes on, since the comparison between the
   * vector and the span is the thing that has to come out unambiguous.
   *
   * A number this close to zero is the axis, not a direction near it.
   */
  const inferred = {
    start,
    end,
    magnitude: Math.hypot(end.x - start.x, end.y - start.y),
    angle:
      (Math.atan2(end.y - start.y, end.x - start.x) * 180) / Math.PI,
  };

  return {
    id: "force-1",
    type: "force",
    geometry: { ...inferred, ...extra, start },
    style: { stroke: "#000000", lineWidth: 0.5 },
  };
};

/*
 * A CHECK ON THE CHECK.
 *
 * Everything below is asserted in screen coordinates, which only means
 * something if the projection is the real one. A bare state silently
 * projects to null, and then every force comes back "not drawn" - so all
 * these checks would pass while testing nothing at all. The projection is
 * therefore asserted first, and every expectation below is read in terms
 * of what it says.
 */
const bounds = canvas.getBoundingClientRect();
const S = global.enggDrawingState;

const origin = S.engineeringToScreen(
  { x: 0, y: 0 },
  bounds,
  base,
);

const east = S.engineeringToScreen(
  { x: 100, y: 0 },
  bounds,
  base,
);

const north = S.engineeringToScreen(
  { x: 0, y: 100 },
  bounds,
  base,
);

console.log("\n  the sheet's axes are the ones it thinks they are\n");

check(
  "the projection produces real points",
  [origin, east, north].every(
    p => Number.isFinite(p.x) && Number.isFinite(p.y),
  ),
  `origin ${JSON.stringify(origin)}`,
);

check(
  "world +x is to the right on screen",
  east.x > origin.x && Math.abs(east.y - origin.y) < 1e-9,
  `east ${JSON.stringify(east)} vs origin ${JSON.stringify(origin)}`,
);

check(
  "world +y is UP on screen, so its screen y is smaller",
  north.y < origin.y && Math.abs(north.x - origin.x) < 1e-9,
  `north ${JSON.stringify(north)} vs origin ${JSON.stringify(origin)}`,
);

console.log("\n  a force with two ends: the head is at the far end\n");

/*
 * FOUR QUADRANTS, because the bug is a sign and a sign is invisible in one
 * of them. A test that only checked +x would pass against code that drew
 * every other direction wrong.
 */
[
  ["+x", { end: { x: 100, y: 0 } }, 1, 0],
  ["-x", { end: { x: -100, y: 0 } }, -1, 0],
  ["+y", { end: { x: 0, y: 100 } }, 0, -1],
  ["-y", { end: { x: 0, y: -100 } }, 0, 1],
  ["quadrant I", { end: { x: 100, y: 100 } }, 1, -1],
  ["quadrant II", { end: { x: -100, y: 100 } }, -1, -1],
  ["quadrant III", { end: { x: -100, y: -100 } }, -1, 1],
  ["quadrant IV", { end: { x: 100, y: -100 } }, 1, 1],
].forEach(([what, extra, wantX, wantY]) => {
  const drawn = drawnForce(forceAt(extra));

  const ok =
    drawn &&
    Math.sign(drawn.screen.dx) === wantX &&
    Math.sign(drawn.screen.dy) === wantY;

  check(
    `a force drawn to ${what} points to ${wantX},${wantY} on screen`,
    ok,
    drawn
      ? `got (${Math.sign(drawn.screen.dx)}, ${Math.sign(drawn.screen.dy)})`
      : "nothing was drawn",
  );
});

console.log("\n  a force described by an angle: same answer\n");

/*
 * THE PATH THE SIGN ERROR WAS ON.
 *
 * An angle-only force is the case that went through `- Math.sin(...)`, and
 * it is the one a student produces by typing a magnitude and a direction.
 * The engineering angle is anticlockwise from +x in a world whose y grows
 * upward, so 90 degrees is up the sheet - which is screen dy NEGATIVE.
 */
[
  ["0 degrees, east", 0, 1, 0],
  ["90 degrees, up", 90, 0, -1],
  ["180 degrees, west", 180, -1, 0],
  ["270 degrees, down", 270, 0, 1],
  ["45 degrees, north-east", 45, 1, -1],
  ["135 degrees, north-west", 135, -1, -1],
  ["225 degrees, south-west", 225, -1, 1],
  ["315 degrees, south-east", 315, 1, 1],
].forEach(([what, angle, wantX, wantY]) => {
  const drawn = drawnForce(
    forceAt({ angle, magnitude: 80 }),
  );

  const ok =
    drawn &&
    Math.sign(drawn.screen.dx) === wantX &&
    Math.sign(drawn.screen.dy) === wantY;

  check(
    `a force at ${what} points to ${wantX},${wantY} on screen`,
    ok,
    drawn
      ? `got (${Math.sign(drawn.screen.dx)}, ${Math.sign(drawn.screen.dy)})`
      : "nothing was drawn",
  );
});

console.log("\n  a zero vector says nothing rather than pointing somewhere\n");

check(
  "a force with no length is not drawn at all",
  drawnForce(
    forceAt({ angle: 45, magnitude: 0 }),
  ) === null,
  "a default arrow pointing right would be a claim about a force that is not there",
);

console.log(
  `\n${pass} passed, ${fail} failed\n`,
);

if (fail) {
  process.exitCode = 1;
}

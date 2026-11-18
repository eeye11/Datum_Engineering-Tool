/*
 * ========================================================
 * THE DISTRIBUTED LOAD'S DIRECTION DOES NOT ROTATE AS THE CURSOR MOVES
 * ========================================================
 *
 * After a Distributed Load's span is defined, the tool must establish ONE
 * fixed reference point - the midpoint of the loaded region - and measure the
 * magnitude/direction vector from that point to the ACTUAL CURSOR.
 *
 * The bug this file pins down: the vector was measured to the resolved
 * construction point, which is SNAPPED. Near an end of the span that point IS
 * the end, so the vector became the fixed midpoint-to-endpoint diagonal and
 * the load swung to a strange angle as the cursor crossed the span - the
 * direction rotating under the student for no reason they asked for.
 *
 * Three things must therefore hold:
 *
 *   1. The origin is the loaded region's midpoint, captured once and never
 *      recomputed from a moving cursor.
 *   2. The direction is measured to the raw (or H/V-constrained) cursor, never
 *      to the snapped construction point.
 *   3. Moving the cursor laterally changes the direction only through the
 *      vector geometry - never by jumping to an endpoint.
 *
 * These drive `constantLoadDraft`, the one function that turns the
 * interaction plus a cursor into the load, so they test the real reading.
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
    console.log(`  FAIL ${name}${detail ? `\n       ${detail}` : ""}`);
  }
};

const { createHarness } = require("./support/harness-renderer.cjs");

createHarness(projectRoot, JSDOM, require);

const { modulePath } = require("./helpers/source-path.cjs");

const loadTool = require(modulePath("load-tool.js"));
const { drawingState } = require(modulePath("editor-state.js"));

const near = (first, second, tolerance = 1e-6) =>
  Math.abs(first - second) <= tolerance;

const degreesOf = (from, to) =>
  (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI;

/*
 * A horizontal Beam loaded from (0, 0) to (300, 0), so the reference point is
 * (150, 0). A level body is where a "direction derived from the span" and a
 * "direction the student drew" are most easily told apart.
 */
const span = {
  start: { x: 0, y: 0 },
  end: { x: 300, y: 0 },
};

const reference = { x: 150, y: 0 };

const loadedRegion = () => ({
  phase: "distributed-load-vector",
  loadSourceId: "beam-1",
  loadStart: { ...span.start },
  loadEnd: { ...span.end },
  loadReferencePoint: { ...reference },
  loadDirection: null,
  loadMagnitude: 0,
});

/*
 * Install an interaction the draft can read, since the vector is only read
 * during the magnitude/direction stage.
 */
const withRegion = (interaction = loadedRegion()) => {
  drawingState.interaction = interaction;

  return interaction;
};

console.log("\n  the reference point is the fixed midpoint\n");

/*
 * The origin is captured when the region is completed and read back, so it
 * does not slide as the cursor moves.
 */
{
  withRegion();

  const origin = loadTool.distributedLoadRegionMidpoint();

  check(
    "the reference point is the midpoint of the loaded region",
    origin && near(origin.x, 150) && near(origin.y, 0),
    JSON.stringify(origin),
  );
}

/*
 * THE ORIGIN MUST NOT MOVE WITH THE SPAN. If something mutated the span
 * during the vector stage, a recomputed origin would slide and rotate the
 * load. The captured reference must win.
 */
{
  const interaction = withRegion();

  interaction.loadStart = { x: 100, y: 0 };
  interaction.loadEnd = { x: 200, y: 0 };

  const origin = loadTool.distributedLoadRegionMidpoint();

  check(
    "and it does not move when the span state changes underneath it",
    origin && near(origin.x, 150) && near(origin.y, 0),
    JSON.stringify(origin),
  );
}

console.log("\n  the direction is the cursor vector from that point\n");

/*
 * Straight up from the midpoint is a vertical load.
 */
{
  withRegion();

  const cursor = { x: 150, y: 80 };

  const draft = loadTool.constantLoadDraft(
    drawingState.interaction,
    cursor,
    cursor,
  );

  check(
    "a cursor above the midpoint gives a vertical load",
    draft && near(draft.direction, 90),
    `direction was ${draft?.direction}`,
  );
}

/*
 * Straight down is the opposite vertical.
 */
{
  withRegion();

  const cursor = { x: 150, y: -80 };

  const draft = loadTool.constantLoadDraft(
    drawingState.interaction,
    cursor,
    cursor,
  );

  check(
    "a cursor below the midpoint gives a downward load",
    draft && near(draft.direction, -90),
    `direction was ${draft?.direction}`,
  );
}

/*
 * Along the span, horizontally: the cursor is off to the right of the
 * midpoint, so the load points right - NOT perpendicular to the body.
 */
{
  withRegion();

  const cursor = { x: 260, y: 0 };

  const draft = loadTool.constantLoadDraft(
    drawingState.interaction,
    cursor,
    cursor,
  );

  check(
    "a cursor along the span gives a horizontal load",
    draft && near(draft.direction, 0),
    `direction was ${draft?.direction}`,
  );
}

/*
 * An arbitrary diagonal is allowed - nothing forces the load square to the
 * body or along it.
 */
{
  withRegion();

  const cursor = { x: 210, y: 60 };

  const expected = degreesOf(reference, cursor);

  const draft = loadTool.constantLoadDraft(
    drawingState.interaction,
    cursor,
    cursor,
  );

  check(
    "a diagonal cursor gives that exact diagonal",
    draft && near(draft.direction, expected),
    `direction was ${draft?.direction}, expected ${expected}`,
  );
}

console.log("\n  moving along the span does not rotate the load oddly\n");

/*
 * THE CORE BUG. The cursor slides right, staying the same height. The true
 * angle from the fixed midpoint changes, and the load follows THAT - it must
 * never jump to the midpoint-to-endpoint diagonal (180) just because the
 * cursor passed near an end.
 */
{
  withRegion();

  const cursor = { x: 280, y: 80 };

  const expected = degreesOf(reference, cursor);

  const draft = loadTool.constantLoadDraft(
    drawingState.interaction,
    cursor,
    cursor,
  );

  check(
    "sliding right gives the cursor's own angle",
    draft && near(draft.direction, expected),
    `direction was ${draft?.direction}, expected ${expected}`,
  );

  check(
    "and not the midpoint-to-endpoint diagonal",
    draft && !near(draft.direction, 180),
    `direction was ${draft?.direction}`,
  );
}

/*
 * The same on the other side, so neither end reintroduces it.
 */
{
  withRegion();

  const cursor = { x: 20, y: 80 };

  const expected = degreesOf(reference, cursor);

  const draft = loadTool.constantLoadDraft(
    drawingState.interaction,
    cursor,
    cursor,
  );

  check(
    "sliding left gives the cursor's own angle",
    draft && near(draft.direction, expected),
    `direction was ${draft?.direction}, expected ${expected}`,
  );

  check(
    "and not the other endpoint diagonal",
    draft && !near(draft.direction, 0),
    `direction was ${draft?.direction}`,
  );
}

console.log("\n  a snapped endpoint cannot become the direction\n");

/*
 * THE EXACT FAILURE. The resolved construction point has snapped onto a span
 * end, while the raw cursor is above the midpoint. The draft takes both: the
 * snapped point as the station cursor and the raw point as the direction
 * cursor. The direction must come from the RAW one.
 *
 * Aiming from the snapped endpoint would give 180 (midpoint -> start); aiming
 * from the raw cursor gives 90.
 */
{
  withRegion();

  const snappedPoint = { x: 0, y: 0 };
  const rawCursor = { x: 150, y: 80 };

  const draft = loadTool.constantLoadDraft(
    drawingState.interaction,
    snappedPoint,
    rawCursor,
  );

  check(
    "the direction comes from the raw cursor, not the snapped end",
    draft && near(draft.direction, 90),
    `direction was ${draft?.direction}; the snapped point would give 180`,
  );

  check(
    "and the loaded region is unchanged",
    draft && near(draft.start.x, 0) && near(draft.end.x, 300),
    JSON.stringify({ start: draft?.start, end: draft?.end }),
  );
}

/*
 * And on the far end, for symmetry.
 */
{
  withRegion();

  const snappedPoint = { x: 300, y: 0 };
  const rawCursor = { x: 150, y: 80 };

  const draft = loadTool.constantLoadDraft(
    drawingState.interaction,
    snappedPoint,
    rawCursor,
  );

  check(
    "and neither does the far snapped end",
    draft && near(draft.direction, 90),
    `direction was ${draft?.direction}; the snapped point would give 0 (180 on the other side)`,
  );
}

console.log("\n  the vector reading is the same one the commit uses\n");

/*
 * `takeDistributedLoadVector` reads the SAME fields as the draft - the fixed
 * origin and the passed cursor - so the preview and the committed load cannot
 * disagree about the angle.
 */
{
  withRegion();

  const rawCursor = { x: 210, y: 60 };

  const draft = loadTool.constantLoadDraft(
    drawingState.interaction,
    rawCursor,
    rawCursor,
  );

  const source = require("fs").readFileSync(modulePath("load-tool.js"), "utf8");

  check(
    "the commit reads the vector from the passed cursor",
    /export function takeDistributedLoadVector\(\s*origin,\s*point,\s*directionPoint = point/.test(
      source,
    ),
    "the commit does not accept a direction cursor",
  );

  check(
    "and from the same fixed region midpoint",
    /function loadVectorUnderPointer\(\s*cursor\s*\)/.test(source) &&
      /distributedLoadRegionMidpoint\(\)/.test(source),
    "the direction vector is not measured from the fixed region midpoint",
  );

  check(
    "so the preview angle is a real load angle",
    draft && Number.isFinite(draft.direction),
    `direction was ${draft?.direction}`,
  );
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);

if (fail) {
  process.exitCode = 1;
}

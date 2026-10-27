/* eslint-disable no-console */
/*
 * ========================================================
 * SNAPPING AND INFERENCE WHILE A FEATURE IS DRAGGED
 * ========================================================
 *
 * Reported: horizontal and vertical inference works while a feature is
 * DRAWN and not while an existing feature is MOVED. A line could be drawn
 * exactly level and could not be dragged exactly level, and no guide
 * appeared during a drag.
 *
 * The cause was architectural, and it is the thing these tests hold down.
 * Direct manipulation is not a construction tool, so `resolvePointerPoint`
 * returns the BARE pointer for it - no object snap, no horizontal or
 * vertical inference. The snap engine was never broken; the drag simply
 * never reached it.
 *
 * TWO LAYERS ARE CHECKED, and deliberately so:
 *
 *   1. BEHAVIOUR - the REAL snap engine, driven with exactly the options
 *      the drag now passes, must actually pull a near-horizontal or
 *      near-vertical cursor into line, and must also align against other
 *      geometry. This is the part that proves the mechanism works rather
 *      than merely that some code exists.
 *
 *   2. WIRING - `pointer.js` and `drag.js` are DOM-coupled, so they cannot
 *      be imported here the way the snap module can. Their source is read
 *      instead, which is the same technique `load-direction-snap.test.cjs`
 *      already uses, and it pins the three things that would silently
 *      remove snapping from a drag again: the drag resolver existing, the
 *      drag using it, and the capture of a STABLE drag reference.
 */

const fs = require("fs");
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

const { createHarness } = require("./harness-renderer.cjs");

createHarness(projectRoot, JSDOM, require);

const { modulePath, loadModule, locate } = require("./helpers/source-path.cjs");

const snapModule = loadModule("object-snap.js");
const snap = snapModule.default || snapModule;

const { drawingState } = require(modulePath("editor-state.js"));

const near = (a, b, t = 1e-9) => Math.abs(a - b) <= t;

/*
 * Snapping is on and there is a document to align against, which is the
 * state the tools work in. One plain line is in the sheet so the candidate
 * search has something real to find.
 */
drawingState.objects = [
  {
    id: "line-1",
    type: "line",
    geometry: {
      start: { x: 0, y: 100 },
      end: { x: 300, y: 100 },
    },
  },
];

drawingState.selection = { selectedObjectIds: [] };

drawingState.objectSnap = drawingState.objectSnap || {};
drawingState.objectSnap.enabled = true;

const boundary = {
  left: -10000,
  right: 10000,
  top: -10000,
  bottom: 10000,
  width: 900,
  height: 600,
};

/*
 * Resolve a raw cursor EXACTLY as the drag now does: the drag's own
 * reference is the anchor, it is offered both as `lineStart` and as an
 * inference reference, inference is preferred over a pure snap, and the
 * tool is Select.
 */
function dragResolve(rawCursor, anchor) {
  return snap.resolveConstructionPoint(
    { ...rawCursor },
    drawingState,
    boundary,
    {
      lineStart: anchor,
      inferenceReferences: anchor ? [anchor] : [],
      preferInference: true,
      tool: "select",
    },
  );
}

/* ============================================================
   A. DIRECTION INFERENCE FROM THE DRAG ORIGIN
   ============================================================ */

console.log(
  "\n  a feature dragged approximately horizontally is pulled level\n",
);

/*
 * The anchor is where the feature was grabbed. A cursor a few degrees off
 * the anchor's row must come back on the anchor's EXACT y - a drag that
 * looks horizontal and stores y = 100.4 is the defect the inference exists
 * to prevent.
 */
const grab = { x: 150, y: 200 };

[
  { x: 397.5, y: 204, label: "3 degrees above the row" },
  { x: 397.5, y: 196, label: "3 degrees below the row" },
  { x: 397.5, y: 200, label: "dead level" },
].forEach(({ x, y, label }) => {
  const resolution = dragResolve({ x, y }, grab);

  check(
    `a cursor ${label} resolves onto the drag origin's row`,
    resolution.effectiveConstructionPoint &&
      near(resolution.effectiveConstructionPoint.y, grab.y) &&
      near(resolution.effectiveConstructionPoint.x, x),
    JSON.stringify(resolution.effectiveConstructionPoint),
  );

  check(
    `and the inference is reported as horizontal (${label})`,
    resolution.inference && resolution.inference.type === "horizontal",
    resolution.inference && resolution.inference.type,
  );
});

/* ---------------------------------------------------------------- */
console.log(
  "\n  a feature dragged approximately vertically is pulled upright\n",
);

[
  { x: 154, y: 502.5, label: "3 degrees right of the column" },
  { x: 146, y: 502.5, label: "3 degrees left of the column" },
  { x: 150, y: 502.5, label: "dead upright" },
].forEach(({ x, y, label }) => {
  const resolution = dragResolve({ x, y }, grab);

  check(
    `a cursor ${label} resolves onto the drag origin's column`,
    resolution.effectiveConstructionPoint &&
      near(resolution.effectiveConstructionPoint.x, grab.x) &&
      near(resolution.effectiveConstructionPoint.y, y),
    JSON.stringify(resolution.effectiveConstructionPoint),
  );

  check(
    `and the inference is reported as vertical (${label})`,
    resolution.inference && resolution.inference.type === "vertical",
    resolution.inference && resolution.inference.type,
  );
});

/* ---------------------------------------------------------------- */
console.log(
  "\n  the projection is on the INFERRED point, not merely flagged\n",
);

/*
 * THE CENTRAL REQUIREMENT. A guide appearing is not enough: the point the
 * preview is drawn from must BE the inferred point. If the resolver reported
 * an inference but returned the raw cursor, a shape would show an alignment
 * line and stay off axis.
 */
const offAxis = dragResolve({ x: 397.5, y: 206 }, grab);

check(
  "the effective point differs from the raw cursor",
  !near(offAxis.effectiveConstructionPoint.y, 206),
  `effective y was ${offAxis.effectiveConstructionPoint.y}`,
);

check(
  "and it equals the reported inference point",
  offAxis.inference &&
    near(offAxis.effectiveConstructionPoint.x, offAxis.inference.point.x) &&
    near(offAxis.effectiveConstructionPoint.y, offAxis.inference.point.y),
  `${JSON.stringify(offAxis.effectiveConstructionPoint)} vs ${JSON.stringify(
    offAxis.inference && offAxis.inference.point,
  )}`,
);

/* ============================================================
   B. ALIGNMENT AGAINST EXISTING GEOMETRY
   ============================================================ */

console.log("\n  a dragged point aligns with existing geometry\n");

/*
 * The sheet's line runs at y = 100. A cursor slightly off that row, dragged
 * from an anchor that is NOT on the row, must still be pulled to the line's
 * row - that is alignment against geometry rather than against the drag
 * origin, and it is the case a snapped feature relies on.
 */
const elsewhere = { x: 50, y: 300 };
const nearLineRow = dragResolve({ x: 420, y: 103 }, elsewhere);

check(
  "a cursor near an existing line's row is pulled onto it",
  near(nearLineRow.effectiveConstructionPoint.y, 100),
  `effective y was ${nearLineRow.effectiveConstructionPoint.y}`,
);

/* ============================================================
   C. FREE MOVEMENT IS UNCHANGED
   ============================================================ */

console.log("\n  a cursor clearly off every axis still moves freely\n");

/*
 * The inference must not catch a cursor that is plainly somewhere else.
 * 45 degrees from the anchor is far outside the shared 7-degree band, so the
 * point must come back where the cursor is.
 */
const diagonal = dragResolve({ x: 397.5, y: 450 }, grab);

check(
  "a cursor 45 degrees off the origin is NOT constrained",
  near(diagonal.effectiveConstructionPoint.x, 397.5) &&
    near(diagonal.effectiveConstructionPoint.y, 450),
  JSON.stringify(diagonal.effectiveConstructionPoint),
);

/* ============================================================
   D. THE WIRING THAT WOULD SILENTLY REMOVE IT AGAIN
   ============================================================ */

console.log("\n  the drag actually reaches the shared resolver\n");

const pointerSource = fs.readFileSync(locate("pointer.js"), "utf8");
const dragSource = fs.readFileSync(locate("drag.js"), "utf8");
const handlesSource = fs.readFileSync(locate("handles.js"), "utf8");

check(
  "pointer.js exports a drag-aware resolver",
  /export function resolveManipulationPoint\s*\(/.test(pointerSource),
);

check(
  "it runs the SHARED resolver rather than a snap engine of its own",
  /resolveManipulationPoint[\s\S]{0,1600}drawingSnap\.resolveConstructionPoint\(/.test(
    pointerSource,
  ),
  "a parallel snap engine for dragging is exactly what the task forbids",
);

/*
 * The check reads the FUNCTION BODY, not a fixed distance from its name.
 *
 * This used to be /resolveManipulationPoint[\s\S]{0,2000}preferInference/,
 * a window of 2000 characters after the function name. That measures how
 * far the code sits from its own declaration, which is not a property of
 * the software: adding a paragraph of comments to the function pushed
 * `preferInference: true` past the limit and failed the test while the
 * behaviour was untouched. Extracting the body asks the question the test
 * means to ask - is the option set INSIDE this function? - and cannot be
 * broken by re-indenting or documenting the code.
 */
function functionBody(source, name) {
  const start = source.indexOf(`function ${name}`);
  if (start === -1) return "";
  let depth = 0;
  let opened = false;
  for (let i = start; i < source.length; i++) {
    const c = source[i];
    if (c === "{") { depth++; opened = true; }
    else if (c === "}") { depth--; if (opened && depth === 0) return source.slice(start, i + 1); }
  }
  return source.slice(start);
}

const resolverBody = functionBody(pointerSource, "resolveManipulationPoint");

check(
  "it prefers inference, so alignment is considered over the dragged feature itself",
  /preferInference:\s*true/.test(resolverBody),
);

check(
  "the drag resolves geometry through that function",
  /resolveManipulationPoint\(\s*\n?\s*event/.test(dragSource),
);

check(
  "a dimension and an annotate still follow the raw pointer",
  /draggingDimension[\s\S]{0,400}resolvePointerEvent\(event\)/.test(dragSource),
);

console.log("\n  the drag keeps a STABLE reference for the whole gesture\n");

/*
 * The reference is captured once at pointer down. Re-reading it on every
 * move would make the inference measure the cursor against itself, so the
 * feature could never be pulled into line.
 */
check(
  "an anchor is captured when a handle drag begins",
  /kind:\s*hit\.handle\.kind[\s\S]{0,1200}anchor:\s*hit\.handle\.point/.test(
    dragSource,
  ),
);

check(
  "an anchor is captured when a whole-feature move begins",
  /kind:\s*"body"[\s\S]{0,900}anchor:\s*\{ \.\.\.point \}/.test(dragSource),
);

check(
  "the anchor is read from the drag, not recomputed from the pointer",
  /anchor:[\s\S]{0,600}|\bdrag\?\.anchor\b/.test(dragSource) ||
    /\bdrag\?\.anchor\b/.test(pointerSource),
);

check(
  "the resolver reads the drag's captured anchor",
  /drag\?\.anchor/.test(pointerSource),
);

console.log("\n  transient snap state is cleared with the gesture\n");

check(
  "a committed drag clears its snap state",
  /finishManipulationDrag[\s\S]{0,1200}guideline:\s*null/.test(dragSource) ||
    /guideline:\s*null[\s\S]{0,1200}finishManipulationDrag/.test(dragSource),
);

check(
  "a cancelled drag clears its snap state too",
  /cancelManipulationDrag[\s\S]{0,900}guideline:\s*null/.test(handlesSource),
);

console.log("\n  the ordinary pointer path is untouched\n");

/*
 * A construction tool must still reach the pipeline it always did, so the
 * drag change cannot have replaced or shadowed the non-drag resolver.
 */
check(
  "resolvePointerEvent is still exported and unchanged in shape",
  /export function resolvePointerEvent\(\s*event\s*\)\s*\{[\s\S]{0,200}?resolvePointerPoint\(/.test(
    pointerSource,
  ),
);

console.log(`\n  ${pass} passed, ${fail} failed\n`);

if (fail) {
  process.exitCode = 1;
}

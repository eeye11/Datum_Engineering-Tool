/*
 * ========================================================
 * BOX SELECTION: WHAT A RECTANGLE TOUCHES
 * ========================================================
 *
 * The requirement, restated as tests: a selection rectangle selects every
 * feature whose DRAWN GEOMETRY it crosses - not merely the features whose
 * centre happens to fall inside it - and it does so for the graph features
 * (SFD/BMD/AFD) as well as for bodies, loads and supports.
 *
 * A SKETCH'S STROKES ARE ORDINARY FEATURES. They used to be graph-local points
 * stored on the diagram, projected onto the axis by the renderer - and box
 * selection had to reproduce that projection or it tested numbers that were not
 * where the ink was. They are Line, Polyline and Arc features now, drawn in
 * world space, so the ordinary box-selection pass catches them as the features
 * they are.
 *
 * A PLOT is still projected, because its curve is generated from expressions
 * rather than drawn - and that projection is the renderer's own
 * `analysisPlotMarks`, so the rectangle and the ink are the same geometry.
 */

const { JSDOM } = require("jsdom");

const { modulePath } = require("./helpers/source-path.cjs");

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

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  pretendToBeVisual: true,
  url: "https://datum.test/",
});

global.window = dom.window;
global.document = dom.window.document;
global.Element = dom.window.Element;

const state = require(modulePath("drawing-state.js")).default;
const box = require(modulePath("box-selection.js"));
const renderer = require(modulePath("renderer.js")).default;

/*
 * THE RENDERER IS PUBLISHED BY NAME, as the page publishes it.
 *
 * `box-selection` reaches for `enggDrawingRenderer` rather than importing it,
 * because in the browser every script shares one scope. Under `require` there
 * is no shared scope, so the name has to be put on the global - and it has to
 * be put there HERE, because another test in the same run may already have set
 * it to a different object.
 */
global.enggDrawingRenderer = renderer;
global.window.enggDrawingRenderer = renderer;

const st = state.createDrawingState();
global.window.enggDrawing = { state: st };

const rect = (minX, minY, maxX, maxY) => ({ minX, minY, maxX, maxY });

/* ============================================================
 * THE BASICS: a line crossed by the rectangle
 * ============================================================ */

console.log("\n  a rectangle selects what it CROSSES, not what it contains\n");

{
  const line = state.geometryFactories.line({ x: 0, y: 0 }, { x: 100, y: 0 });

  check(
    "a long line whose middle the rectangle crosses is selected",
    box.objectIntersectsSelection(line, rect(40, -10, 60, 10)) === true,
    "most of the line lies outside the box",
  );

  check(
    "and a rectangle nowhere near it does not",
    box.objectIntersectsSelection(line, rect(200, 200, 260, 260)) === false,
  );

  check(
    "a rectangle that merely touches an endpoint still selects it",
    box.objectIntersectsSelection(line, rect(100, -5, 140, 5)) === true,
  );

  check(
    "a degenerate rectangle drawn exactly ON the line selects it",
    box.objectIntersectsSelection(line, rect(20, 0, 80, 0)) === true,
    "a zero-height drag along the line",
  );
}

/* ============================================================
 * A SKETCHED DIAGRAM: its strokes are ordinary features
 * ============================================================
 *
 * A Sketch is no longer a private coordinate space inside the diagram. Its
 * strokes are ordinary Line, Polyline and Arc features that belong to the
 * diagram through `parentId`, drawn where the student drew them. So a box over
 * a stroke catches the STROKE - which is what lets it be selected, moved and
 * deleted on its own - and the diagram itself is selected from its frame.
 */

console.log(
  "\n  a SKETCHED diagram's strokes are selected as the features they are\n",
);

{
  const diagram = state.geometryFactories["shear-force-diagram"](
    { x: 0, y: 0 },
    { x: 100, y: 0 },
  );

  diagram.geometry.mode = "sketch";

  /* A stroke drawn in WORLD space, as the Sketch mode now draws them. */
  const stroke = state.geometryFactories.line({ x: 0, y: 0 }, { x: 50, y: 40 });

  stroke.parentId = diagram.id;

  check(
    "a rectangle over the middle of a stroke selects the stroke",
    box.objectIntersectsSelection(stroke, rect(23, 18, 27, 22)) === true,
  );

  check(
    "and a rectangle away from it selects nothing",
    box.objectIntersectsSelection(stroke, rect(900, 900, 950, 950)) === false,
  );

  /*
   * THE DIAGRAM IS STILL SELECTABLE ON ITS OWN. A sketch diagram with no plot
   * has no curve to cross, so the box is aimed at the member it is drawn on -
   * the same span the diagram's frame occupies.
   */
  check(
    "the diagram itself is selected from its own frame",
    box.objectIntersectsSelection(diagram, rect(40, -5, 60, 5)) === true,
  );
}

/* ============================================================
 * A CURVE stroke, partly intersecting
 * ============================================================ */

console.log("\n  a partially-intersecting curve is selected\n");

{
  const curve = state.geometryFactories.polyline(
    [
      { x: 0, y: 0 },
      { x: 100, y: 80 },
      { x: 200, y: 0 },
    ],
    {},
  );

  check(
    "a rectangle over ONLY the top of the curve selects it",
    box.objectIntersectsSelection(curve, rect(97, 77, 103, 83)) === true,
    "a small portion entering the box is enough",
  );
}

/* ============================================================
 * STATICS: the same logic, no special case
 * ============================================================ */

console.log("\n  Statics features go through the SAME test\n");

{
  const beam = state.geometryFactories.beam({ x: 0, y: 0 }, { x: 160, y: 0 });

  const support = state.geometryFactories["pin-support"]({ x: 40, y: 0 });
  const force = state.geometryFactories.force(
    { x: 80, y: 0 },
    { x: 80, y: -50 },
  );
  const load = state.geometryFactories.load(
    { x: 0, y: 0 },
    { x: 160, y: 0 },
    5,
  );
  const moment = state.geometryFactories.moment({ x: 120, y: 0 }, 200, 0);

  check(
    "a beam crossed by the rectangle is selected",
    box.objectIntersectsSelection(beam, rect(70, -10, 90, 10)) === true,
  );

  check(
    "a support at the rectangle's edge is selected",
    box.objectIntersectsSelection(support, rect(30, -10, 70, 10)) === true,
  );

  check(
    "a point force is selected along its whole arrow",
    box.objectIntersectsSelection(force, rect(75, -30, 85, -10)) === true,
    "not only at its application point",
  );

  check(
    "a distributed load is selected on its span",
    box.objectIntersectsSelection(load, rect(70, -5, 90, 5)) === true,
  );

  check(
    "a moment is selected at its point",
    box.objectIntersectsSelection(moment, rect(110, -10, 130, 10)) === true,
  );

  check(
    "and a rectangle away from all of them selects none",
    [beam, support, force, load, moment].every(
      (object) =>
        box.objectIntersectsSelection(object, rect(400, 400, 500, 500)) ===
        false,
    ),
  );
}

/* ============================================================
 * ONE SWEEP, MANY FEATURES
 * ============================================================ */

console.log("\n  one rectangle selects several features at once\n");

{
  const objects = [
    state.geometryFactories.line({ x: 0, y: 0 }, { x: 100, y: 0 }),
    state.geometryFactories.line({ x: 0, y: 20 }, { x: 100, y: 20 }),
    state.geometryFactories.line({ x: 0, y: 200 }, { x: 100, y: 200 }),
  ];

  const swept = objects.filter((object) =>
    box.objectIntersectsSelection(object, rect(-5, -5, 105, 25)),
  );

  check(
    "a rectangle spanning two lines takes exactly those two",
    swept.length === 2,
    `took ${swept.length}`,
  );
}

/* ============================================================
 * A DEGENERATE RECTANGLE
 * ============================================================ */

console.log("\n  the rectangle's own corner cases\n");

{
  const point = state.geometryFactories.point({ x: 50, y: 50 });

  check(
    "a zero-size rectangle on a point selects it",
    box.objectIntersectsSelection(point, rect(50, 50, 50, 50)) === true,
  );

  check(
    "a zero-size rectangle beside it does not",
    box.objectIntersectsSelection(point, rect(51, 51, 51, 51)) === false,
  );
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);

if (fail) {
  process.exitCode = 1;
}

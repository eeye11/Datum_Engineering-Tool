
const { JSDOM } = require("jsdom");

const path = require("path");
const fs = require("fs");

const { controllerSource, loadModule, locate, modulePath, sourceDir } = require("./helpers/source-path.cjs");
/*
 * ========================================================
 * THE Y RANGE
 * ========================================================
 *
 * The graph's vertical scale is DERIVED by default - whatever the largest
 * value happens to be is fitted to the frame. A student who has just typed
 * one equation should see it fill the box, not sit as a flat line along the
 * axis.
 *
 * A SET range overrides that, and the decision worth testing is HOW. It
 * clips rather than replaces: the frame is widened to hold whichever is
 * larger, the student's range or their own diagram.
 *
 * The alternative - draw to the set range and let anything taller run off
 * the top - is silent. A curve that leaves the frame is indistinguishable
 * from a curve that stops there, and a student would read the second as
 * their own answer. So the unit height is chosen from the larger of the two,
 * and nothing is ever quietly trimmed.
 */


const projectRoot = path.join(__dirname, "..");
const dir = sourceDir();

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

const dom = new JSDOM(
  '<!doctype html><html><body><div id="canvas"></div></body></html>',
  { pretendToBeVisual: true },
);

global.window = dom.window;
global.document = dom.window.document;
global.navigator = dom.window.navigator;
global.requestAnimationFrame = (cb) => setTimeout(cb, 0);
global.window.requestAnimationFrame = global.requestAnimationFrame;
global.window.cancelAnimationFrame = (id) => clearTimeout(id);

for (const name of [
  "measurement-core.js",
  "quantities.js",
  "dimension-model.js",
  "annotation-model.js",
  "diagram-equations.js",
  "load-profile.js",
  "body-frames.js",
  "feature-geometry.js",
  "drawing-state.js",
  "analysis-dependencies.js",
  "renderer.js",
]) {
  loadModule(name);
}

const renderer = global.window.enggDrawingRenderer;

/*
 * `analysisValueScale` is not exported - it is an internal of the frame
 * geometry, and exporting it purely so a test could reach it would widen
 * the module's surface for no product reason. So the scale is observed
 * THROUGH the marks: draw a diagram, and read back where its peak landed.
 */
/*
 * THE MARKS ARE IN SCALED WORLD UNITS.
 *
 * A value of 10 over a 500-long body is drawn at world y = 80, not y = 10 -
 * the scale is baked into the mark, because a renderer wants a place to
 * draw and a reader wants a value.
 *
 * So the peak cannot be compared with the value directly. What CAN be
 * compared is the peak AGAINST ITSELF: the same value under different
 * ranges. That ratio is exactly what the clipping decision changes, and it
 * is what these assertions are about.
 */
const peakFor = (geometry) => {
  const marks = renderer.analysisPlotMarks({
    ...geometry,
    start: { x: 0, y: 0 },
    end: { x: 500, y: 0 },
  });

  const curve = marks.find((m) => m.kind !== "verticalLine");

  if (!curve || !curve.points?.length) {
    return null;
  }

  return curve.points.reduce(
    (peak, p) => Math.max(peak, Math.abs(p.y)),
    0,
  );
};

const base = {
  diagramType: "sfd",
  localRange: { from: 0, to: 500 },
  expressions: [
    {
      id: "e1",
      relationType: "functionX",
      expression: "10",
      xRange: { start: 0, end: 500 },
    },
  ],
};

const marksFor = peakFor;

console.log("\n  with no range the diagram fits itself\n");

const auto = peakFor(base);

check(
  "a constant 10 is drawn above the axis",
  auto > 0,
  `drew a peak of ${auto}`,
);

console.log("\n  a set range LARGER than the diagram shrinks it\n");

/*
 * The student's range is -20 to 20 and their diagram peaks at 10, so the
 * frame is sized for 20 and the 10 occupies half of it. That is the point
 * of setting a range: the value now reads against a known scale instead of
 * always being stretched to fill.
 */
const wider = peakFor({
  ...base,
  yRange: { from: -20, to: 20 },
});

check(
  "the same value now takes half the height",
  Math.abs(wider - auto / 2) < 1e-6,
  `range 20 drew ${wider}, auto drew ${auto}, half would be ${auto / 2}`,
);

console.log("\n  a set range SMALLER than the diagram does not cut it off\n");

/*
 * The range is -2 to 2 and the diagram peaks at 10. The frame is sized for
 * the larger of the two, so the range sits inside the frame and the diagram
 * is drawn complete.
 *
 * The alternative - drawing to the set range and letting the rest run off
 * the top - is silent: a curve that leaves the frame is indistinguishable
 * from a curve that stops there, and the student would read the second as
 * their own answer.
 */
const narrower = peakFor({
  ...base,
  yRange: { from: -2, to: 2 },
});

check(
  "the diagram is still drawn whole",
  Math.abs(narrower - auto) < 1e-6,
  `range 2 drew ${narrower}, auto drew ${auto} - the curve was truncated`,
);

console.log("\n  a range that is not a range yet is ignored\n");

/*
 * A minimum above its maximum is a half-typed value. Treating it as a
 * scale would invert the diagram, so it must fall back to fitting - the
 * same answer as no range at all.
 */
const backwards = marksFor({
  ...base,
  yRange: { from: 20, to: -20 },
});

check(
  "a backwards range is treated as no range",
  Math.abs(backwards - auto) < 1e-6,
  `backwards drew ${backwards}, auto drew ${auto}`,
);

const partial = marksFor({
  ...base,
  yRange: { from: -20 },
});

check(
  "and so is half of one",
  Math.abs(partial - auto) < 1e-6,
  `a half-typed range drew ${partial}, auto drew ${auto}`,
);

console.log("\n  and an empty value means auto, not zero\n");

const blank = marksFor({
  ...base,
  yRange: { from: undefined, to: undefined },
});

check(
  "an empty range still draws the diagram",
  Math.abs(blank - auto) < 1e-6,
  `blank drew ${blank}, auto drew ${auto}`,
);

/*
 * THE PANEL SHOWS THE RANGE, IN THE RIGHT UNIT.
 *
 * A bending moment is kN-m and a shear force is kN, so a Y Range typed
 * against the wrong unit is wrong by a factor of a metre. The unit comes
 * from the diagram type and is stated beside the field.
 */
console.log("\n  the unit is the one the diagram measures\n");

const source = controllerSource();

check(
  "a shear diagram's range is in kN",
  /sfd:\s*"kN"/.test(source),
);

check(
  "a moment diagram's range is in kN-m",
  /*
   * The file contains the ESCAPE `\u00b7`, not the character it stands for,
   * so the pattern has to match the backslash-u sequence. A regex written
   * with a real middle dot looks for the character and finds nothing.
   */
  /bmd:\s*"kN\\u00b7m"/.test(source),
  "a moment range is not in N-m, or the escape is written differently",
);

check(
  "and it is read from the diagram type, not typed in",
  /\[geometry\.diagramType\]/.test(source),
);

console.log(`\n  ${pass} passed, ${fail} failed\n`);

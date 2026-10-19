
const path = require("path");

const { loadModule, locate, modulePath, sourceDir } = require("./helpers/source-path.cjs");
/*
 * The ANGULAR dimension's drawn arc, tested directly.
 *
 * This exists because of a bug that no existing assertion could see.
 * An angular dimension reported the right NUMBER and drew a visibly
 * wrong ARC beside it: two lines meeting at a corner produced a
 * dimension reading 57.57 degrees whose arc swept 151 degrees. Both
 * halves were "correct" on their own terms, and every test that
 * checked the value passed.
 *
 * The cause was in how the legs were taken. The angle is drawn about
 * the vertex where the two spans meet - and when two spans are drawn
 * to a shared corner, that vertex IS one end of each span. Asking for
 * the direction from the vertex toward that same end gives a vector of
 * length zero, from which no arc can be built, so the tessellation ran
 * off on whatever degenerate direction it was handed.
 *
 * So the assertion here is that the DRAWN ARC SUBTENDS THE SAME ANGLE
 * AS THE LABEL. That is the property a reader relies on and the one
 * neither half checked alone.
 *
 * Pure module, so it runs in Node.
 */

global.window = { crypto: { randomUUID: () => "angular-uuid" } };

loadModule("measurement-core.js");
loadModule("dimension-model.js");

const model = global.window.enggDimensionModel;

let pass = 0;
let fail = 0;
const check = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(
      `  FAIL ${name}\n       expected ${JSON.stringify(expected)}` +
        `\n       actual   ${JSON.stringify(actual)}`
    );
  }
};

/*
 * The angle the drawn arc actually subtends, measured at the vertex.
 *
 * Deliberately measured off the POINTS rather than read from the text,
 * because that is the quantity that was wrong while the text stayed
 * right.
 */
const sweptAngle = (graphics) => {
  const { arc, vertex } = graphics;

  const bearing = (point) =>
    Math.atan2(point.y - vertex.y, point.x - vertex.x) * (180 / Math.PI);

  let total = 0;

  for (let i = 1; i < arc.length; i += 1) {
    let step = bearing(arc[i]) - bearing(arc[i - 1]);

    while (step > 180) step -= 360;
    while (step < -180) step += 360;

    total += step;
  }

  return Math.abs(total);
};

/*
 * Two lines meeting at a shared corner - the case that failed.
 *
 * BOTH spans end at the same point, so the vertex is spanA.end, which
 * is exactly the configuration that produced a zero-length leg.
 */
const corner = {
  scale: { mmPerUnit: 1, unit: "mm" },
  objects: [
    {
      id: "a",
      type: "line",
      style: {},
      metadata: {},
      geometry: { start: { x: -20, y: -10 }, end: { x: 0, y: 0 } }
    },
    {
      id: "b",
      type: "line",
      style: {},
      metadata: {},
      geometry: { start: { x: -20, y: 10 }, end: { x: 0, y: 0 } }
    }
  ]
};

const [first, second] = corner.objects;

/* The unified Dimension tool's pair describer (formerly Smart Dimension's). */
const descriptor = require(locate("dimension-candidates.js")).default.describePair(
  first,
  second,
  corner
)[0];

console.log("\nTwo lines meeting at a corner");
check("the pair yields an angular measurement", descriptor.dimensionType, "angular");

const dimension = model.createDimension({
  dimensionType: "angular",
  refs: descriptor.refs,
  placement: { x: -12, y: 0 }
});

const graphics = model.graphicsFor(dimension, corner);

check("it has graphics", typeof graphics, "object");
check("of kind angular", graphics.kind, "angular");
check("with a tessellated arc", graphics.arc.length > 2, true);
check("and the two legs as extensions", graphics.extensions.length, 2);

console.log("\nThe arc agrees with the number beside it");
const stated = Number(String(graphics.text).replace(/[^\d.]/g, ""));

check("the label states the included angle", stated > 0, true);
check(
  "and the arc is drawn through that same angle",
  Math.round(sweptAngle(graphics) * 100) / 100,
  Math.round(stated * 100) / 100
);

console.log("\nThe arc is a real arc, not a collapsed one");
const firstPoint = graphics.arc[0];
const lastPoint = graphics.arc[graphics.arc.length - 1];

check(
  "every point is at the same radius from the vertex",
  Math.abs(
    Math.hypot(firstPoint.x - graphics.vertex.x, firstPoint.y - graphics.vertex.y) -
      Math.hypot(lastPoint.x - graphics.vertex.x, lastPoint.y - graphics.vertex.y)
  ) < 0.01,
  true
);
check(
  "and none of them sits on the vertex",
  graphics.arc.every(
    (p) => Math.hypot(p.x - graphics.vertex.x, p.y - graphics.vertex.y) > 0.01
  ),
  true
);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

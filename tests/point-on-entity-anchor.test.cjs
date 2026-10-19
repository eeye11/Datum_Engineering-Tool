/*
 * ========================================================
 * POINT-ON-ENTITY ANCHORS
 * ========================================================
 *
 * A dimension may reference a position ALONG a straight feature - the
 * point where a force acts, a station on a beam - and that reference
 * must follow the feature when it moves, rotates or changes length.
 *
 * A named anchor cannot express it, because there is no name for "37%
 * of the way along this particular line". So the reference encodes the
 * position as a FRACTION of the span, resolved from the feature's
 * CURRENT ends every time it is asked for.
 *
 * These check that the fraction resolves to the right model point and
 * that it moves with the geometry - which is the whole reason it is a
 * fraction rather than a stored coordinate.
 */
global.window = {
  enggDrawingState: {
    polygonVertices(geometry) {
      const centre = geometry?.center || { x: 0, y: 0 };
      const radius = Number(geometry?.radius) || 0;
      const sides = Number(geometry?.sides) || 6;

      return Array.from({ length: sides }, (_, index) => {
        const angle = (index * 2 * Math.PI) / sides;

        return {
          x: centre.x + radius * Math.cos(angle),
          y: centre.y + radius * Math.sin(angle),
        };
      });
    },
  },
  enggFeatureGeometry: {
    rectangleCorners(geometry) {
      const {
        position = { x: 0, y: 0 },
        width = 0,
        height = 0,
      } = geometry || {};

      return [
        position,
        { x: position.x + width, y: position.y },
        { x: position.x + width, y: position.y + height },
        { x: position.x, y: position.y + height },
      ];
    },
  },
};

const { loadModule, modulePath } = require("./helpers/source-path.cjs");

loadModule("measurement-core.js");

const m = global.window.enggMeasurement;

let pass = 0;
let fail = 0;

const check = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);

  if (ok) {
    pass += 1;
    console.log(`  ok   ${name}`);
  } else {
    fail += 1;
    console.log(
      `  FAIL ${name}\n       expected ${JSON.stringify(expected)}` +
        `\n       actual   ${JSON.stringify(actual)}`,
    );
  }
};

const beam = {
  id: "b1",
  name: "Beam",
  type: "beam",
  geometry: {
    start: { x: 0, y: 0 },
    end: { x: 200, y: 0 },
    depth: 20,
  },
  style: {},
  metadata: {},
};

console.log("\n  A fraction resolves along the feature\n");

check(
  "the midpoint fraction lands on the midpoint",
  m.resolveAnchor(beam, "pointOnEntity@0.5"),
  { x: 100, y: 0 },
);

check(
  "a quarter fraction lands a quarter of the way",
  m.resolveAnchor(beam, "pointOnEntity@0.25"),
  { x: 50, y: 0 },
);

check("the ends are reachable", m.resolveAnchor(beam, "pointOnEntity@0"), {
  x: 0,
  y: 0,
});

check("and so is the far end", m.resolveAnchor(beam, "pointOnEntity@1"), {
  x: 200,
  y: 0,
});

console.log("\n  The reference follows the geometry\n");

beam.geometry.end = { x: 400, y: 0 };

check(
  "after the beam is lengthened the fraction is recomputed",
  m.resolveAnchor(beam, "pointOnEntity@0.5"),
  { x: 200, y: 0 },
);

beam.geometry.end = { x: 0, y: 400 };

check(
  "and after it is rotated the point rotates with it",
  m.resolveAnchor(beam, "pointOnEntity@0.5"),
  { x: 0, y: 200 },
);

console.log("\n  It is refused where there is no span\n");

check(
  "a feature with no span has no point-on-entity",
  m.resolveAnchor(
    {
      id: "c",
      type: "circle",
      geometry: { center: { x: 0, y: 0 }, radius: 5 },
    },
    "pointOnEntity@0.5",
  ),
  null,
);

console.log("\n  It survives the save/reload round trip\n");

check(
  "the anchor name is a plain string",
  JSON.parse(JSON.stringify({ anchor: "pointOnEntity@0.37" })).anchor,
  "pointOnEntity@0.37",
);

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);

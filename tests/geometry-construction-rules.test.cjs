/* eslint-disable no-console */
/*
 * ========================================================
 * GEOMETRY CONSTRUCTION RULES
 * ========================================================
 *
 * The pure rules behind the construction gestures, tested without a canvas:
 *
 *   - a Freeform Polygon CLOSES when the pointer returns to its first vertex,
 *     and a two-vertex shape never closes into a degenerate triangle;
 *   - a regular Polygon's SIDE method treats the dragged segment as an ACTUAL
 *     side, so the committed polygon's first two vertices are the dragged
 *     ends;
 *   - a regular Polygon's CENTRE method places the first vertex on the
 *     circumcircle at the dragged direction;
 *   - the side count is an integer of at least three, defaulting to six.
 *
 * These are the rules a source generator depends on: if the side method were
 * quietly a radius, the TikZ would draw a polygon whose edge is not the one
 * the student dragged.
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

const { createHarness } = require("./harness-renderer.cjs");

createHarness(projectRoot, JSDOM, require);

const { loadModule } = require("./helpers/source-path.cjs");

const creation = loadModule("geometry-creation.js");

const near = (a, b, tolerance = 1e-9) => Math.abs(a - b) <= tolerance;

/* ================================================== freeform closing */

console.log("\nClosing a Freeform Polygon");
console.log("--------------------------");

const square = {
  points: [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 },
  ],
};

check(
  "the first vertex itself closes the polygon",
  creation.closingFreeformPolygon({ x: 0, y: 0 }, square),
);

check(
  "a point well inside the closing band closes it",
  creation.closingFreeformPolygon({ x: 6, y: 6 }, square),
  "the band is a fraction of the polygon's own size",
);

check(
  "a point across the polygon does not",
  !creation.closingFreeformPolygon({ x: 100, y: 100 }, square),
);

check(
  "a single placed vertex has nothing to close",
  !creation.closingFreeformPolygon(
    { x: 0, y: 0 },
    { points: [{ x: 0, y: 0 }] },
  ),
);

check(
  "the closing band scales with the polygon, not with the zoom",
  creation.closingFreeformPolygon(
    { x: 1.5, y: 0 },
    {
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
      ],
    },
  ),
  "a small polygon is as easy to close as a large one",
);

check(
  "a missing interaction is not a close",
  !creation.closingFreeformPolygon({ x: 0, y: 0 }, null),
);

/* ===================================================== side count */

console.log("\nThe side count");
console.log("--------------");

check(
  "an explicit count is used",
  creation.polygonSideCount({ polygonSides: 7 }) === 7,
);
check(
  "a fractional count is rounded",
  creation.polygonSideCount({ polygonSides: 5.6 }) === 6,
);
check(
  "fewer than three falls back to six",
  creation.polygonSideCount({ polygonSides: 2 }) === 6,
);
check("nothing at all falls back to six", creation.polygonSideCount({}) === 6);

/* ==================================================== polygon side */

console.log("\nPolygon by side: the dragged segment IS an edge");
console.log("-----------------------------------------------");

const sideInteraction = {
  polygonMode: "sides",
  polygonSides: 4,
  points: [{ x: 0, y: 0 }],
};

const sideBeside = creation.polygonFromCursor(sideInteraction, { x: 40, y: 0 });

const sideVertices = (definition) => {
  const { center, radius, sides, rotation } = definition;

  /* `rotation` is radians and places vertex 0; the vertices go round evenly. */
  return Array.from({ length: sides }, (_, index) => {
    const angle = rotation + (index * 2 * Math.PI) / sides;

    return {
      x: center.x + radius * Math.cos(angle),
      y: center.y + radius * Math.sin(angle),
    };
  });
};

const vertices = sideVertices(sideBeside);

const firstVertex = vertices[0];
const secondVertex = vertices[1 % vertices.length];

check(
  "vertex 0 is the first dragged endpoint",
  near(firstVertex.x, 0, 1e-6) && near(firstVertex.y, 0, 1e-6),
  `(${firstVertex.x}, ${firstVertex.y})`,
);

check(
  "vertex 1 is the second dragged endpoint - the segment is a real side",
  near(secondVertex.x, 40, 1e-6) && near(secondVertex.y, 0, 1e-6),
  `(${secondVertex.x}, ${secondVertex.y})`,
);

const sideLength = Math.hypot(
  secondVertex.x - firstVertex.x,
  secondVertex.y - firstVertex.y,
);

check(
  "so the side's length is the length that was dragged",
  near(sideLength, 40, 1e-6),
  `side was ${sideLength}, dragged 40`,
);

/* Every side of a regular polygon is the same length. */
const allSidesEqual = vertices.every((vertex, index) => {
  const next = vertices[(index + 1) % vertices.length];

  return near(Math.hypot(next.x - vertex.x, next.y - vertex.y), 40, 1e-6);
});

check("and the polygon is regular at that edge length", allSidesEqual);

/* ================================================== polygon centre */

console.log("\nPolygon by centre: the dragged point sets size and orientation");
console.log("-------------------------------------------------------------");

const centreInteraction = {
  polygonMode: "centre",
  polygonSides: 6,
  points: [{ x: 20, y: 30 }],
};

const byCentre = creation.polygonFromCursor(centreInteraction, {
  x: 20,
  y: 50,
});

check(
  "the first click is the centre",
  near(byCentre.center.x, 20) && near(byCentre.center.y, 30),
);

check(
  "the dragged distance is the circumradius",
  near(byCentre.radius, 20, 1e-9),
  `radius was ${byCentre.radius}`,
);

const centreVertices = sideVertices(byCentre);

check(
  "and the first vertex sits on the circumcircle in the dragged direction",
  near(centreVertices[0].x, 20, 1e-6) && near(centreVertices[0].y, 50, 1e-6),
  `(${centreVertices[0].x}, ${centreVertices[0].y})`,
);

check(
  "a zero-radius drag makes no polygon",
  creation.polygonFromCursor(centreInteraction, { x: 20, y: 30 }) === null,
);

check(
  "and a zero-length side makes none either",
  creation.polygonFromCursor(sideInteraction, { x: 0, y: 0 }) === null,
);

console.log(`\n${pass} passed, ${fail} failed`);

if (fail > 0) {
  process.exitCode = 1;
}

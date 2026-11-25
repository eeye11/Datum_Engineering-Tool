/* eslint-disable no-console */
/*
 * ========================================================
 * ONE STATICS OBJECT: VALUE, GEOMETRY, TEXT
 * ========================================================
 *
 * The architectural rule this suite holds to:
 *
 *   A force's numerical magnitude, its displayed arrow, and its label are three
 *   SEPARATE things - and they are all parts of ONE object. Not three objects,
 *   not a label row in the list, not two selection states.
 *
 * The checks below are the ones that catch the failure this replaced: the old
 * Vector Scale derived an arrow's length from the value, so typing a magnitude
 * resized the arrow (and dragging the arrow changed the value). Label placement
 * was computed in four different places, so the canvas and the Source could put
 * the same words in two spots.
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

const { loadModule } = require("./helpers/source-path.cjs");

const label = loadModule("statics-label.js").default;
const objectsList = loadModule("objects-list.js");
const model = loadModule("drawing-state.js").default;

const lengthOf = (g) => Math.hypot(g.end.x - g.start.x, g.end.y - g.start.y);

const force = model.geometryFactories.force(
  { x: 0, y: 0 },
  { x: 0, y: 40 },
  {},
);

/* ============================================ three parts, one object */

console.log("\nA force is one object with three parts");
console.log("-------------------------------------");

check(
  "the drawn arrow is the geometry the student drew",
  Math.abs(lengthOf(force.geometry) - 40) < 1e-6,
  String(lengthOf(force.geometry)),
);

/*
 * THE VALUE IS NOT THE LENGTH. Typing a magnitude must leave the arrow exactly
 * where it was drawn - the retired Vector Scale is what made these the same
 * number.
 */
const drawnBefore = lengthOf(force.geometry);

force.geometry.magnitude = 5000;

check(
  "typing a magnitude does not resize the arrow",
  Math.abs(lengthOf(force.geometry) - drawnBefore) < 1e-6,
  `arrow became ${lengthOf(force.geometry)}`,
);

check(
  "and the value it was given is the value it has",
  force.geometry.magnitude === 5000,
  String(force.geometry.magnitude),
);

/* The label is the object's own property, not a second feature. */
force.label = "F";

check("the label lives ON the force", force.label === "F", String(force.label));

/* =========================================== label placement is shared */

console.log("\nOne label placement, asked by every layer");
console.log("-----------------------------------------");

const home = label.labelHomeOf(force);

check("a force's label has a place", Boolean(home), JSON.stringify(home));

check(
  "and it sits past the arrowhead, not across the shaft",
  home.y > 40,
  JSON.stringify(home),
);

const moved = label.labelHomeOf({
  ...force,
  geometry: { ...force.geometry, labelOffset: { x: 10, y: -5 } },
});

check(
  "the student's own offset moves it, in drawing units",
  Math.abs(moved.x - (home.x + 10)) < 1e-6 &&
    Math.abs(moved.y - (home.y - 5)) < 1e-6,
  `${JSON.stringify(moved)} vs ${JSON.stringify(home)}`,
);

check(
  "and an empty label has a place but no words",
  label.labelTextOf({ ...force, label: "" }) === "",
  label.labelTextOf({ ...force, label: "" }),
);

/* ============================================== an empty label is empty */

console.log("\nA label starts empty");
console.log("--------------------");

check(
  "a newly created force carries no label",
  typeof model.geometryFactories.force({ x: 0, y: 0 }, { x: 0, y: 10 }, {})
    .label !== "string" ||
    model.geometryFactories.force({ x: 0, y: 0 }, { x: 0, y: 10 }, {}).label ===
      "",
  "a factory prepopulated the label",
);

/* ======================================================== the tree */

console.log("\nChildren fold into their parent, once");
console.log("--------------------------------------");

const objects = [
  {
    id: "beam-1",
    type: "beam",
    name: "Beam 1",
    geometry: { start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
  },
  {
    id: "force-1",
    type: "force",
    name: "Point Load 1",
    parentId: "beam-1",
    geometry: { start: { x: 30, y: 0 }, end: { x: 30, y: 30 } },
  },
  {
    id: "axes-1",
    type: "coordinate-system-2d",
    name: "Coordinate System 1",
    geometry: { origin: { x: 0, y: 0 } },
  },
];

const markup = objectsList.objectsListMarkup(objects, []);
const dom = new JSDOM(`<body>${markup}</body>`).window.document;

const tops = [
  ...dom.querySelectorAll(".drawing-objects-list > [data-object-id]"),
];

/*
 * ONE ROW PER OBJECT. A force's own label is part of the force, so it adds no
 * row; a child adds a row INSIDE its parent, never beside it.
 */
check(
  "three objects on the sheet give three rows, and no more",
  (markup.match(/role="option"/g) || []).length === 3,
  String((markup.match(/role="option"/g) || []).length)
);

check(
  "the sheet has two top-level rows, not three",
  tops.length === 2,
  tops.map((row) => row.dataset.objectId).join(", "),
);

const beam = dom.querySelector('[data-object-id="beam-1"]');
const child = dom.querySelector('[data-object-id="force-1"]');

check(
  "the child is inside its parent's node",
  Boolean(beam && child) && beam.contains(child),
);

check(
  "the child's list is a SEPARATE element, below the parent's row line",
  child?.parentElement?.classList.contains("drawing-objects-children") === true,
  child?.parentElement?.className,
);

check(
  "the parent row is marked expanded, and offers a disclosure",
  beam?.getAttribute("aria-expanded") === "true" &&
    Boolean(beam.querySelector("[data-disclosure-for]")),
  beam?.outerHTML?.slice(0, 200),
);

check(
  "a reference object stays a top-level row",
  Boolean(
    dom.querySelector('.drawing-objects-list > [data-object-id="axes-1"]'),
  ),
);

console.log(`\n${pass} passed, ${fail} failed`);

if (fail > 0) {
  process.exitCode = 1;
}

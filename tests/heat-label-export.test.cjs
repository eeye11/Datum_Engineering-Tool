/*
 * ========================================================
 * A LABEL EXPORTS BESIDE ITS OBJECT, NOT SOMEWHERE ELSE
 * ========================================================
 *
 * The exported TikZ must place a notation at its PARENT'S anchor plus its own
 * offset, and must not invent a marker for an object that already draws itself.
 * These checks read the generated source and compare the two coordinates, so
 * "the label sits beside the node" is arithmetic rather than a screenshot.
 */
const { JSDOM } = require("jsdom");
const path = require("path");

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

["drawingToolMessage"].forEach((id) => {
  const e = document.createElement("div");
  e.id = id;
  document.body.appendChild(e);
});

const { loadModule } = require("./helpers/source-path.cjs");

const model = loadModule("heat-model.js");
const labels = loadModule("heat-labels.js");
const annotateWriter = loadModule("annotations.js");
const heatWriter = loadModule("source-writers/heat-transfer.js");

const point = (x, y) => ({ x, y });

/* Every `(x,y)` in a piece of source, in order. */
const coordinates = (source) =>
  [
    ...String(source ?? "").matchAll(
      /\((-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)\)/g,
    ),
  ].map((match) => ({ x: Number(match[1]), y: Number(match[2]) }));

console.log("\nA notation beside its object");
console.log("---------------------------");

const center = point(-180, -15);
const node = model.createCircuitNode({ center });
const label = labels.createHeatLabel(node, { objects: [node] });

/* The writer resolves the parent through the published lookup. */
const store = new Map([[node.id, node]]);
annotateWriter.setAnnotationObjectLookup((id) => store.get(id) || null);

const nodeSource = heatWriter.heatTransferSourceWriter(node);
const labelSource = annotateWriter.annotationSourceWriter(label);

const nodePoints = coordinates(nodeSource);
const labelPoints = coordinates(labelSource);

check(
  "the node is drawn at its own centre",
  nodePoints.length >= 1 &&
    Math.abs(nodePoints[0].x - center.x) < 1e-6 &&
    Math.abs(nodePoints[0].y - center.y) < 1e-6,
  JSON.stringify(nodePoints[0]),
);

check(
  "the label is written as ONE node and no marker",
  labelPoints.length === 1 &&
    !/\\fill/.test(labelSource) &&
    !/circle/.test(labelSource),
  labelSource
    .split("\n")
    .filter((line) => line.startsWith("\\"))
    .join(" | "),
);

const offset = label.metadata.heatLabelOffset;
const at = labelPoints[0];

check(
  "its position is the parent's anchor PLUS its own offset",
  Math.abs(at.x - (center.x + offset.x)) < 1e-6 &&
    Math.abs(at.y - (center.y + offset.y)) < 1e-6,
  `label=${JSON.stringify(at)} expected=(${center.x + offset.x}, ${center.y + offset.y})`,
);

check(
  "and the gap is small - sized from the node's own radius, not a fixed push",
  Math.hypot(offset.x, offset.y) < 20,
  JSON.stringify(offset),
);

/* ---------------------------------------------------------- follows its parent */

console.log("\nThe label follows its parent");
console.log("----------------------------");

/* Move the parent, keeping its stored position one frame behind on purpose. */
node.geometry = { ...node.geometry, center: point(-100, 40) };

const movedSource = annotateWriter.annotationSourceWriter(label);
const movedAt = coordinates(movedSource)[0];

check(
  "a moved parent's label is written at the NEW anchor plus the SAME offset",
  Math.abs(movedAt.x - (-100 + offset.x)) < 1e-6 &&
    Math.abs(movedAt.y - (40 + offset.y)) < 1e-6,
  JSON.stringify(movedAt),
);

/* ---------------------------------------------------------- manual placement */

console.log("\nA label the student moved");
console.log("-------------------------");

const custom = { x: 26, y: 5 };

labels.rememberHeatLabelOffset(label, node);
label.metadata = {
  ...label.metadata,
  heatLabelOffset: custom,
};

const customSource = annotateWriter.annotationSourceWriter(label);
const customAt = coordinates(customSource)[0];

check(
  "a deliberately moved label keeps ITS offset, not the default one",
  Math.abs(customAt.x - (-100 + custom.x)) < 1e-6 &&
    Math.abs(customAt.y - (40 + custom.y)) < 1e-6,
  JSON.stringify(customAt),
);

/* ---------------------------------------------------------- independent objects */

console.log("\nTwo objects are not merged by their labels");
console.log("------------------------------------------");

const freePoint = {
  type: "point",
  id: "point-1",
  name: "Point 1",
  label: "",
  geometry: { position: point(60, 60) },
  style: {},
};

const nodeB = model.createCircuitNode({ center: point(10, 10) });
const labelB = labels.createHeatLabel(nodeB, { objects: [nodeB] });

store.set(nodeB.id, nodeB);

const pointSource = coordinates(
  annotateWriter.annotationSourceWriter({
    ...freePoint,
    type: "annotate",
    annotateKind: "note",
    text: "P1",
  }),
);

check(
  "a point keeps its own position whatever a node's label does",
  freePoint.geometry.position.x === 60 && freePoint.geometry.position.y === 60,
);

check(
  "and its exported text sits at ITS position",
  pointSource.length >= 1 &&
    Math.abs(pointSource[0].x - 60) < 1e-6 &&
    Math.abs(pointSource[0].y - 60) < 1e-6,
  JSON.stringify(pointSource[0]),
);

void labelB;

/* ---------------------------------------------------------- other families */

console.log("\nOther labelled objects");
console.log("----------------------");

for (const [name, parent, expectedGap] of [
  [
    "a source",
    model.createSourceSink({ center: point(0, 0), variant: "source" }),
    40,
  ],
  [
    "a circuit element",
    model.createCircuitElement({ center: point(0, 0), variant: "resistance" }),
    40,
  ],
]) {
  const own = labels.createHeatLabel(parent, { objects: [parent] });
  const gap = Math.hypot(
    own.metadata.heatLabelOffset.x,
    own.metadata.heatLabelOffset.y,
  );

  check(
    `${name}'s label clears the symbol without being flung away`,
    gap > 4 && gap < expectedGap,
    String(gap.toFixed(2)),
  );
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);

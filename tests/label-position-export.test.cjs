/*
 * ========================================================
 * LABEL POSITION IN THE EXPORTED TikZ
 * ========================================================
 *
 * A label must be written BESIDE the object it names, at the object's own
 * coordinates plus an intentional offset - never at an unrelated point, and
 * never with a second marker of its own.
 *
 * The defects these checks pin, found in real generated source:
 *
 *   a Circuit Node at (-180,-15) whose label was written at (-157.8,-1.68),
 *   twenty-two units away from a dot four units wide, WITH a stray
 *   `\fill ... circle[radius=0.35]` under the text - a marker for an object
 *   that already draws itself.
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
const drawingStateModule = loadModule("drawing-state.js");
const { drawingState } = loadModule("editor-state.js");

/*
 * THE WRITER'S OWN SHEET LOOKUP, published exactly as the editor publishes it.
 *
 * Without it the writer cannot find a label's parent and falls back to the
 * label's cached position - which is correct behaviour, but it means this test
 * would never exercise the derived-coordinate path it is here to prove.
 */
if (typeof annotateWriter.setAnnotationObjectLookup === "function") {
  annotateWriter.setAnnotationObjectLookup((id) =>
    (drawingState.objects || []).find((object) => object?.id === id) || null,
  );
}

const point = (x, y) => ({ x, y });

/* The one node in the source, as { x, y, text }. */
function writtenNode(source) {
  /*
   * THE DRAWING COMMAND, not a comment that happens to contain the word.
   *
   * The DAETUM header above every block carries the object's ID, and a Heat
   * label's ID is `heat-label-thermal-circuit-node-...` - so "the first line
   * containing node" was the COMMENT. Only a line that actually draws is
   * considered.
   */
  const line = String(source || "")
    .split("\n")
    .find((candidate) => candidate.trim().startsWith("\\node"));

  if (!line) {
    return null;
  }

  /* `at (-168.6,-11.01)` - the coordinate pair after `at`, negatives included. */
  /*
   * THE `at` THAT PRECEDES THE COORDINATES, not the first `(...)` in the line:
   * the options carry `font=\fontsize{16pt}{19.2pt}`, which has braces and is
   * matched by the text pattern instead.
   */
  const at = /\bat\s+\(([-\d.]+),\s*([-\d.]+)\)/.exec(line);
  const text = /\{([\s\S]*)\}/.exec(line);

  return at
    ? { x: Number(at[1]), y: Number(at[2]), text: text ? text[1] : "", line }
    : null;
}

/* One line of source, for a failure message that actually explains itself. */
function nodeLine(source) {
  return String(source || "")
    .split("\n")
    .filter((line) => line.includes("node"))
    .join(" | ");
}

void nodeLine;

/* Every marker circle in a piece of source. */
function markers(source) {
  return String(source || "")
    .split("\n")
    .filter((line) => /circle\[radius=/.test(line));
}

/* ---------------------------------------------------------- placement */

console.log("\nA node's label sits beside the node");
console.log("-----------------------------------");

const node = model.createCircuitNode({ center: point(-180, -15) });
const label = labels.createHeatLabel(node, { objects: [node] });

const nodeSource = annotateWriter.annotationSourceWriter(label);
const written = writtenNode(nodeSource);

check("the label is written as a node at all", Boolean(written), nodeSource);

/* The default offset, from the model's own answer. */
const offset = label.metadata.heatLabelOffset;

check(
  "the offset is a small, deliberate placement",
  Math.abs(offset.x) <= 20 && Math.abs(offset.y) <= 12,
  JSON.stringify(offset),
);

check(
  "the written point is the NODE's centre plus that offset",
  written &&
    Math.abs(written.x - (-180 + offset.x)) < 1e-6 &&
    Math.abs(written.y - (-15 + offset.y)) < 1e-6,
  written
    ? `wrote (${written.x},${written.y}) from centre (-180,-15)`
    : "no node",
);

check(
  "the label is not written far from its object",
  written && Math.hypot(written.x - -180, written.y - -15) < 25,
  written ? String(Math.hypot(written.x - -180, written.y - -15)) : "",
);

/* ---------------------------------------------------------- no duplicate marker */

console.log("\nNo duplicate marker");
console.log("-------------------");

check(
  "the label does NOT emit its own anchor dot",
  markers(nodeSource).length === 0,
  markers(nodeSource).join(" | "),
);

check(
  "the node itself writes only its own symbol",
  (nodeSource.match(/circle\[radius/g) || []).length <= 1,
  nodeSource,
);

/* A FREE label - no parent - still gets its anchor dot when it marks a point. */
const freeLabel = labels.createHeatLabel(
  model.createTemperatureMarker({ center: point(40, 40), text: "T" }),
  { objects: [] },
);

void freeLabel;

const freeStandalone = {
  type: "annotate",
  annotateKind: "label",
  text: "A",
  geometry: { start: point(0, 0), position: point(30, 0) },
  style: {},
};

const freeSource = annotateWriter.annotationSourceWriter(freeStandalone);

check(
  "a FREESTANDING label keeps its anchor dot",
  markers(freeSource).length === 1,
  freeSource,
);

/* ---------------------------------------------------------- following the parent */

console.log("\nThe label follows its parent");
console.log("----------------------------");

drawingState.objects = [];

drawingStateModule.default.addObject(drawingState, node);

const liveLabel = labels.createHeatLabel(node, {
  objects: drawingState.objects,
});

if (liveLabel) {
  drawingStateModule.default.addObject(drawingState, liveLabel);
}

const storedOffset = { ...liveLabel.metadata.heatLabelOffset };

/* Move the node. */
const moved = drawingState.objects.find(
  (candidate) => candidate.id === node.id,
);

moved.geometry = { ...moved.geometry, center: point(100, 60) };

labels.reconcileHeatLabels(drawingState.objects);

const movedSource = annotateWriter.annotationSourceWriter(
  drawingState.objects.find((candidate) => candidate.id === liveLabel.id),
);

const movedNode = writtenNode(movedSource);

check(
  "after moving the node, the label is written at the NEW centre plus the same offset",
  movedNode &&
    Math.abs(movedNode.x - (100 + storedOffset.x)) < 1e-6 &&
    Math.abs(movedNode.y - (60 + storedOffset.y)) < 1e-6,
  movedNode ? `(${movedNode.x},${movedNode.y})` : "no node",
);

check(
  "the offset itself is unchanged by the move",
  Math.abs(liveLabel.metadata.heatLabelOffset.x - storedOffset.x) < 1e-9 &&
    Math.abs(liveLabel.metadata.heatLabelOffset.y - storedOffset.y) < 1e-9,
);

/* A manual move is preserved. */
liveLabel.geometry = { ...liveLabel.geometry, position: point(300, 300) };

labels.rememberHeatLabelOffset(
  liveLabel,
  drawingState.objects.find((candidate) => candidate.id === node.id),
);

const manualOffset = { ...liveLabel.metadata.heatLabelOffset };

const manualSource = annotateWriter.annotationSourceWriter(liveLabel);
const manualNode = writtenNode(manualSource);

check(
  "a manually moved label keeps its own offset in the export",
  manualNode &&
    Math.abs(manualNode.x - (100 + manualOffset.x)) < 1e-6 &&
    Math.abs(manualNode.y - (60 + manualOffset.y)) < 1e-6,
  manualNode ? `(${manualNode.x},${manualNode.y})` : "no node",
);

/* ---------------------------------------------------------- independence */

console.log("\nIndependent objects stay independent");
console.log("------------------------------------");

const a = model.createCircuitNode({ center: point(-180, -15) });
const b = model.createTemperatureMarker({ center: point(50, 50), text: "T" });

const aLabel = labels.createHeatLabel(a, { objects: [a, b] });
const bLabel = labels.createHeatLabel(b, { objects: [a, b] });

const aPoint = writtenNode(annotateWriter.annotationSourceWriter(aLabel));
const bPoint = writtenNode(annotateWriter.annotationSourceWriter(bLabel));

check(
  "two objects keep their own, different label positions",
  aPoint &&
    bPoint &&
    Math.abs(aPoint.x - bPoint.x) > 1 &&
    Math.abs(aPoint.y - bPoint.y) > 1,
  `a=(${aPoint?.x},${aPoint?.y}) b=(${bPoint?.x},${bPoint?.y})\n     a: ${nodeLine(annotateWriter.annotationSourceWriter(aLabel))}`,
);

check(
  "each label is near ITS object, not merged with the other",
  aPoint &&
    bPoint &&
    Math.hypot(aPoint.x - -180, aPoint.y - -15) < 25 &&
    Math.hypot(bPoint.x - 50, bPoint.y - 50) < 25,
  `a: ${nodeLine(annotateWriter.annotationSourceWriter(aLabel))}\n     b: ${nodeLine(
     annotateWriter.annotationSourceWriter(bLabel),
   )}`,
);

/* ---------------------------------------------------------- text size */

console.log("\nText size is stated, not inherited");
console.log("----------------------------------");

check(
  "the label node names its own font size",
  /font=/.test(nodeSource),
  written ? written.line : "",
);

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);

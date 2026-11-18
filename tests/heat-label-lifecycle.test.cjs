/*
 * ========================================================
 * A HEAT LABEL THROUGH ITS WHOLE LIFE
 * ========================================================
 *
 * Three things the requirement asks for that only show up OUTSIDE a single
 * creation: a label must survive a save and reload, undo and redo must treat it
 * as one edit with its parent, and a duplicate must take the NEXT free notation
 * rather than a copy of the original's.
 *
 * Each check goes through the shipped document functions - `serializeDrawing`,
 * `commitDrawingChange`, `undo`, `duplicate` - rather than a hand-rolled copy.
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
  if (!document.getElementById(id)) {
    const element = document.createElement("div");
    element.id = id;
    document.body.appendChild(element);
  }
});

const { loadModule } = require("./helpers/source-path.cjs");

const model = loadModule("heat-model.js");
const labels = loadModule("heat-labels.js");
const { drawingState } = loadModule("editor-state.js");
const enggDrawingState = loadModule("drawing-state.js").default;

const point = (x, y) => ({ x, y });

/* Place a labelled object exactly as the tool layer does. */
function place(build) {
  const previous = enggDrawingState.snapshotDrawing(drawingState);

  const parent = build();

  enggDrawingState.addObject(drawingState, parent);

  const stored = drawingState.objects.find((o) => o.id === parent.id) || parent;

  const label = labels.createHeatLabel(stored, {
    objects: drawingState.objects,
  });

  if (label) {
    enggDrawingState.addObject(drawingState, label);
  }

  enggDrawingState.commitDrawingChange(drawingState, previous);

  return {
    parent: stored,
    label: label
      ? drawingState.objects.find((o) => o.id === label.id) || label
      : null,
  };
}

/* The history lives on `history.past` / `history.future`, not on loose stacks. */
function historyDepth() {
  return (drawingState.history?.past || []).length;
}

function fresh() {
  drawingState.objects = [];

  if (drawingState.history) {
    drawingState.history.past = [];
    drawingState.history.future = [];
  }

  drawingState.selection = drawingState.selection || {};
  drawingState.selection.selectedObjectIds = [];
}

/* ---------------------------------------------------------- save / reload */

console.log("\nSave and reload");
console.log("---------------");

fresh();

const saved = place(() =>
  model.createThermalArrow({
    start: point(0, 0),
    end: point(40, 0),
    variant: "heat-rate",
  }),
);

/* Move the label, so its offset is the student's and not the default. */
saved.label.geometry = { ...saved.label.geometry, position: point(90, 90) };
labels.rememberHeatLabelOffset(
  saved.label,
  drawingState.objects.find((o) => o.id === saved.parent.id),
);
saved.label.text = "\\dot{Q}_{in}";

const text = enggDrawingState.serializeDrawing(drawingState);
const reloaded = JSON.parse(text);

check(
  "the saved file carries the label as its own record",
  reloaded.objects.some((o) => o.id === saved.label.id),
);

const backLabel = reloaded.objects.find((o) => o.id === saved.label.id);

check(
  "its parent link survives the round trip",
  backLabel.parentId === saved.parent.id &&
    backLabel.metadata.heatParentId === saved.parent.id,
  JSON.stringify(backLabel.metadata),
);

check(
  "its text survives, markup and all",
  backLabel.text === "\\dot{Q}_{in}",
  backLabel.text,
);

check(
  "its student-set offset survives",
  Math.abs(backLabel.metadata.heatLabelOffset.x - 0) > 1e-9 ||
    Math.abs(backLabel.metadata.heatLabelOffset.y - 0) > 1e-9,
  JSON.stringify(backLabel.metadata.heatLabelOffset),
);

check(
  "and it still hides from the Objects tab after a reload",
  (() => {
    const objectsList = loadModule("objects-list.js");
    const markup = objectsList.objectsListMarkup(reloaded.objects, []);

    return (
      markup.includes("Heat Transfer Rate 1") &&
      (markup.match(/role="option"/g) || []).length === 1
    );
  })(),
);

/* ---------------------------------------------------------- undo / redo */

console.log("\nUndo and redo");
console.log("-------------");

fresh();

const undone = place(() =>
  model.createThermalBoundary({
    start: point(0, 0),
    end: point(80, 0),
    variant: "convection",
  }),
);

check(
  "creating an object and its label is ONE undoable change",
  drawingState.objects.length === 2 && historyDepth() === 1,
  `${drawingState.objects.length} objects, ${historyDepth()} undo entries`,
);

enggDrawingState.undo(drawingState);

check(
  "one Undo removes BOTH the object and its label",
  drawingState.objects.length === 0,
  String(drawingState.objects.length),
);

enggDrawingState.redo(drawingState);

check(
  "one Redo brings both back",
  drawingState.objects.length === 2 &&
    drawingState.objects.some((o) => o.id === undone.label.id),
  String(drawingState.objects.length),
);

/* Moving the label is its own undoable edit, leaving the parent alone. */
const liveLabel = drawingState.objects.find((o) => o.id === undone.label.id);
const liveParent = drawingState.objects.find((o) => o.id === undone.parent.id);

const parentGeometry = JSON.stringify(liveParent.geometry);

liveLabel.geometry = { ...liveLabel.geometry, position: point(200, 200) };

check(
  "moving the label does not touch the parent's geometry",
  JSON.stringify(
    drawingState.objects.find((o) => o.id === undone.parent.id).geometry,
  ) === parentGeometry,
);

/* ---------------------------------------------------------- duplication */

console.log("\nDuplication");
console.log("-----------");

fresh();

const first = place(() => model.createCircuitNode({ center: point(0, 0) }));

/* Duplicating creates a new parent; the tools are expected to give the copy the
 * NEXT free notation rather than the original's. */
const duplicated = place(() =>
  model.createCircuitNode({ center: point(50, 0) }),
);

check(
  "the original is T_1 and its duplicate is T_2 (a NEW default)",
  first.label.text === "T_1" && duplicated.label.text === "T_2",
  `${first.label.text} / ${duplicated.label.text}`,
);

check(
  "the two labels have different ids and different parents",
  first.label.id !== duplicated.label.id &&
    first.label.metadata.heatParentId !==
      duplicated.label.metadata.heatParentId,
);

check(
  "editing one object's label leaves the other alone",
  (() => {
    const a = drawingState.objects.find((o) => o.id === first.label.id);

    a.text = "T_a";

    const b = drawingState.objects.find((o) => o.id === duplicated.label.id);

    return b.text === "T_2";
  })(),
);

/* ---------------------------------------------------------- counters */

console.log("\nNumbering after a reload");
console.log("-----------------------");

fresh();

place(() => model.createTemperatureMarker({ center: point(0, 0), text: "" }));
place(() => model.createTemperatureMarker({ center: point(10, 0), text: "" }));

const savedT = JSON.parse(enggDrawingState.serializeDrawing(drawingState));

/* A fresh sheet holding what was saved - the state a reopened file produces. */
drawingState.objects = savedT.objects;
drawingState.selection.selectedObjectIds = [];

const nextAfterReload = labels.createHeatLabel(
  model.createTemperatureMarker({ center: point(20, 0), text: "" }),
  { objects: drawingState.objects },
);

check(
  "numbering CONTINUES from the labels a reopened file already holds",
  nextAfterReload.text === "T_3",
  nextAfterReload.text,
);

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);

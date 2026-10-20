/*
 * ========================================================
 * SAVE / OPEN / SAVE AS AND THE UNSAVED-CHANGES WORKFLOW
 * ========================================================
 *
 * Two defects are pinned here, because they had the same symptom - a drawing
 * that could not be opened - but different causes:
 *
 *   1. SAVING A DRAWING THAT CONTAINED AN ANNOTATION THREW.
 *
 *      `serializeDrawing` called JSON.parse(JSON.stringify(object.geometry))
 *      for every feature. An annotation (and a dimension) has no `geometry`
 *      field at all, so `JSON.stringify(undefined)` is `undefined` and
 *      `JSON.parse(undefined)` throws. The whole save failed, which is why an
 *      annotated sheet could never be written or reopened.
 *
 *   2. A BLANK NEW DOCUMENT WAS MARKED DIRTY.
 *
 *      `newDrawing` ended with markDocumentDirty(), so a fresh, untouched
 *      document reported unsaved changes - and the next Open or New
 *      interrupted the student with a prompt about work they had not done.
 *
 * The file format is checked through a genuine round trip, and the dialog is
 * checked through the real UI module.
 */

const { JSDOM } = require("jsdom");
const fs = require("fs");

const { modulePath, locate } = require("./helpers/source-path.cjs");

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
});

global.window = dom.window;
global.document = dom.window.document;
global.HTMLElement = dom.window.HTMLElement;
global.Node = dom.window.Node;
global.MouseEvent = dom.window.MouseEvent;
global.Event = dom.window.Event;

const state = require(modulePath("drawing-state.js")).default;

/* ------------------------------------------------------------------ */
/* 1. A DRAWING WITH AN ANNOTATION AND A DIMENSION CAN BE SERIALISED   */
/* ------------------------------------------------------------------ */

console.log("\n  a drawing containing an annotation can be saved\n");

{
  /*
   * The exact shapes the live model produces: an annotation and a dimension
   * carry their data at the TOP LEVEL and have no `geometry` at all. This is
   * what used to make serialisation throw.
   */
  const annotation = {
    id: "annotation_5",
    name: "Force value",
    type: "annotation",
    annotationKind: "force-value",
    textMode: "auto",
    text: "",
    sourceFeatureId: "force_9",
    anchorRef: null,
    placement: { x: 420, y: 210 },
    placementMode: "manual",
    leader: { enabled: true },
    visible: true,
  };

  const dimension = {
    id: "dimension_3",
    name: "Dimension 1",
    type: "dimension",
    dimensionType: "linear",
    sourceRefs: [{ kind: "between", featureId: "beam_17", anchor: "start" }],
    placement: { x: 10, y: -30 },
    resolved: true,
  };

  const beam = {
    id: "beam_17",
    type: "beam",
    name: "Beam 1",
    geometry: { start: { x: 0, y: 0 }, end: { x: 300, y: 0 } },
    style: { stroke: "#000000" },
  };

  let thrown = null;
  let text = null;

  try {
    text = state.serializeDrawing({
      version: 1,
      units: "mm",
      scale: { mmPerUnit: 2.5, unit: "mm" },
      camera: { zoom: 1, panX: 0, panY: 0 },
      grid: {},
      statics: {},
      snap: {},
      objectSnap: {},
      styleDefaults: {},
      objects: [beam, annotation, dimension],
    });
  } catch (error) {
    thrown = error;
  }

  check(
    "serialising a drawing with an annotation does not throw",
    thrown === null,
    thrown ? thrown.message : ""
  );

  const body = thrown ? {} : JSON.parse(text);

  check(
    "all three features are written",
    Array.isArray(body.objects) && body.objects.length === 3,
    `objects ${(body.objects || []).length}`
  );

  const savedAnnotation = (body.objects || []).find(
    (o) => o.id === "annotation_5"
  );
  const savedDimension = (body.objects || []).find(
    (o) => o.id === "dimension_3"
  );

  check(
    "the annotation is written with its source link",
    savedAnnotation && savedAnnotation.sourceFeatureId === "force_9"
  );

  check(
    "and its manually chosen position",
    savedAnnotation &&
      savedAnnotation.placement &&
      savedAnnotation.placement.x === 420 &&
      savedAnnotation.placement.y === 210
  );

  check(
    "and the fact that the position was the student's choice",
    savedAnnotation && savedAnnotation.placementMode === "manual"
  );

  check(
    "the dimension is written with its measurement references",
    savedDimension &&
      Array.isArray(savedDimension.sourceRefs) &&
      savedDimension.sourceRefs[0].featureId === "beam_17"
  );

  check(
    "a feature with geometry keeps its geometry",
    (body.objects || []).find((o) => o.id === "beam_17")?.geometry?.end?.x ===
      300
  );
}

/* ------------------------------------------------------------------ */
/* 2. THE FILE ROUND TRIPS THROUGH THE REAL FORMAT MODULE              */
/* ------------------------------------------------------------------ */

console.log("\n  the saved file reopens with every part intact\n");

{
  const file = require(modulePath("document-file.js")).default;

  const body = {
    units: "mm",
    sheets: [
      {
        id: "sheet_one",
        name: "Structure",
        scale: { mmPerUnit: 2.5, unit: "mm" },
        objects: [
          {
            id: "beam_17",
            type: "beam",
            name: "Beam 1",
            geometry: { start: { x: 0, y: 0 }, end: { x: 300, y: 0 } },
          },
          {
            id: "force_9",
            type: "force",
            name: "Point Force 1",
            parentId: "beam_17",
            geometry: {
              start: { x: 150, y: 0 },
              end: { x: 150, y: -80 },
            },
          },
          {
            id: "annotation_5",
            type: "annotation",
            annotationKind: "force-value",
            sourceFeatureId: "force_9",
            placement: { x: 420, y: 210 },
            placementMode: "manual",
          },
        ],
      },
      {
        id: "sheet_two",
        name: "Free Body Diagram",
        scale: { mmPerUnit: 10, unit: "mm" },
        objects: [{ id: "line_second", type: "line" }],
      },
    ],
    activeSheetId: "sheet_one",
  };

  const wrapped = file.createDocument(body);

  /* Through text, exactly as a real file travels. */
  const read = file.readDocument(JSON.parse(JSON.stringify(wrapped)));

  check("the file is accepted", read.ok === true, read.failure);

  const doc = read.document || {};

  check(
    "both sheets come back",
    Array.isArray(doc.sheets) && doc.sheets.length === 2
  );

  const first = (doc.sheets || []).find((s) => s.id === "sheet_one") || {};

  check(
    "the active sheet is the one that was active",
    doc.activeSheetId === "sheet_one"
  );

  const second = (doc.sheets || []).find((s) => s.id === "sheet_two") || {};

  /*
   * THE PER-SHEET WORLD SCALE IS RETIRED. A file saved while it existed still
   * opens - every sheet, every feature - but its calibration is not carried
   * into the document: a drawing states what it draws.
   */
  check(
    "an old file's per-sheet world scale is not carried forward",
    first.scale === undefined && second.scale === undefined,
    `first ${JSON.stringify(first.scale)}, second ${JSON.stringify(second.scale)}`
  );

  const force = (first.objects || []).find((o) => o.id === "force_9");

  check(
    "the force still names its parent body by id",
    force && force.parentId === "beam_17"
  );

  const annotation = (first.objects || []).find((o) => o.id === "annotation_5");

  check(
    "the annotation keeps its manual placement",
    annotation &&
      annotation.placement.x === 420 &&
      annotation.placement.y === 210 &&
      annotation.placementMode === "manual"
  );
}

/* ------------------------------------------------------------------ */
/* 3. THE UNSAVED-CHANGES DIALOG OFFERS THREE EXPLICIT CHOICES         */
/* ------------------------------------------------------------------ */

console.log("\n  the unsaved-changes dialog has three explicit answers\n");

{
  const ui = require(modulePath("ui.js")).default;

  /*
   * The labels the dialog actually showed are the evidence, so they are read
   * straight out of the DOM rather than from a second copy of the choices.
   */
  const promised = ui.choiceDialog("This drawing has unsaved changes.", {
    title: "Unsaved changes",
    buttons: [
      { id: "save", label: "Save First", primary: true },
      { id: "discard", label: "Discard Changes" },
      { id: "cancel", label: "Cancel", dismiss: true },
    ],
  });

  const title = document.querySelector(".engg-dialog-title");

  check("the dialog is titled Unsaved changes", title && title.textContent === "Unsaved changes");

  const labels = [...document.querySelectorAll(".engg-dialog-button")].map((b) =>
    b.textContent.trim()
  );

  check(
    "it offers Save First, Discard Changes and Cancel",
    labels.length === 3 &&
      labels.includes("Save First") &&
      labels.includes("Discard Changes") &&
      labels.includes("Cancel"),
    labels.join(" / ")
  );

  check(
    "and it does NOT offer the old, wrong labels",
    !labels.includes("Delete") && !labels.includes("Don't Save"),
    labels.join(" / ")
  );

  /* Escape should dismiss as Cancel - the named dismissal. */
  const backdrop = document.querySelector(".engg-dialog-backdrop");

  backdrop.dispatchEvent(
    new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })
  );

  promised.then((choice) => {
    check(
      "Escape takes the named dismissal, not a destructive choice",
      choice === "cancel",
      String(choice)
    );

    report();
  });
}

/* ------------------------------------------------------------------ */
/* 4. THE COMMANDS ARE WRITTEN AGAINST THE FIXED BEHAVIOUR             */
/* ------------------------------------------------------------------ */

console.log("\n  the commands use the dialog and the dirty state correctly\n");

{
  const source = fs.readFileSync(locate("document-commands.js"), "utf8");

  check(
    "New, Open and the prompt all go through the three-way choice dialog",
    /choiceDialog\(/.test(source)
  );

  check(
    "the three choices are Save First, Discard Changes and Cancel",
    /label:\s*"Save First"/.test(source) &&
      /label:\s*"Discard Changes"/.test(source) &&
      /label:\s*"Cancel"/.test(source)
  );

  check(
    "a blank New document is marked clean, not dirty",
    /markDocumentClean\(\);\s*\n\s*setToolMessage\(\s*\n\s*"New drawing"/.test(
      source
    ),
    "New must not leave an untouched document unsaved"
  );

  check(
    "loading is guarded so restoration cannot mark the document dirty",
    /documentLoading/.test(source) &&
      /beginDocumentLoad\(\)/.test(source) &&
      /endDocumentLoad\(\)/.test(source)
  );

  check(
    "the document is only marked clean after a successful write",
    /documentFileName = saved;[\s\S]{0,80}markDocumentClean\(\)/.test(source)
  );

  check(
    "the dirty flag can be read by tests and the recovery prompt",
    /export function documentHasUnsavedChanges/.test(source)
  );
}

function report() {
  console.log(`\n  ${pass} passed, ${fail} failed\n`);

  if (fail) {
    process.exitCode = 1;
  }
}

/*
 * The dialog's answer arrives on a promise, and the Escape check runs in a
 * .then() callback. Reporting on a short timer lets those microtasks settle,
 * so the last check is counted rather than raced past.
 */
setTimeout(report, 400);

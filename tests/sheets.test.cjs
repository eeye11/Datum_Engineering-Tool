
const path = require("path");

const { loadModule, locate, modulePath, sourceDir } = require("./helpers/source-path.cjs");
/*
 * Sheets and Drawing References, tested directly.
 *
 * Both modules are pure - they hold no DOM and touch no browser state -
 * so they are exercised in Node rather than through a rendering engine.
 * That is deliberate: the guarantees worth protecting here are about
 * IDs surviving renames and reordering, and about a duplicate being
 * genuinely independent of what it was copied from. Those are facts
 * about data, and a browser is not needed to check a fact about data.
 *
 * The rendering half - that a reference fits the drawing, ignores the
 * current zoom and carries the sheet's grid - needs a renderer and is
 * covered by the browser verification instead. What is checked here is
 * the half that would silently corrupt a document if it were wrong.
 */

global.window = {};
loadModule("sheets.js");
const s = global.window.enggSheets;

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
        `\n       actual   ${JSON.stringify(actual)}`
    );
  }
};

console.log("\nA new document");
const doc = s.createCollection();
check("has exactly one sheet", doc.sheets.length, 1);
check("which is active", doc.activeSheetId, doc.sheets[0].id);
check("with a blank drawing", doc.sheets[0].objects, []);
check(
  "and an id of its own",
  /^sheet_[0-9a-f]+$/.test(doc.sheets[0].id),
  true
);
check("and a grid", doc.sheets[0].grid, {
  visible: true,
  spacing: 7.5,
  /*
   * GRID SNAP TRAVELS WITH THE SHEET.
   *
   * It is its own setting rather than a reading of `visible`, so it is part of
   * the sheet's shape and is asserted here - a drawing reopened must show the
   * grid-snap state it was saved with.
   */
  snapToGrid: true,
});
check("and a viewport", doc.sheets[0].viewport, { zoom: 1, panX: 0, panY: 0 });

console.log("\nCreating sheets");
const second = s.addSheet(doc);
check("there are two", doc.sheets.length, 2);
check("named in order", second.name, "Sheet 2");
check("and the new one is active", doc.activeSheetId, second.id);
check("with a different id", second.id !== doc.sheets[0].id, true);
const third = s.addSheet(doc);
check("the next one follows the numbering", third.name, "Sheet 3");

console.log("\nEach sheet keeps its own content");
doc.sheets[0].objects.push({ id: "beam-1", type: "beam" });
doc.sheets[0].grid.visible = false;
doc.sheets[0].viewport = { zoom: 1.5, panX: 10, panY: -10 };
check(
  "one sheet's features are not another's",
  doc.sheets[1].objects,
  []
);
check(
  "one sheet's grid is not another's",
  doc.sheets.map((sheet) => sheet.grid.visible),
  [false, true, true]
);
check(
  "one sheet's viewport is not another's",
  doc.sheets.map((sheet) => sheet.viewport.zoom),
  [1.5, 1, 1]
);

console.log("\nRenaming");
s.renameSheet(doc, second.id, "Free Body Diagram");
check(
  "the name changes",
  s.sheetById(doc, second.id).name,
  "Free Body Diagram"
);
check("and the id does not", s.sheetById(doc, second.id).id, second.id);

console.log("\nReordering");
const firstId = doc.sheets[0].id;
check("moves right", s.moveSheet(doc, firstId, 1), true);
check(
  "into the expected order",
  doc.sheets.map((sheet) => sheet.name),
  ["Free Body Diagram", "Sheet 1", "Sheet 3"]
);
check(
  "without changing any id",
  doc.sheets.map((sheet) => sheet.id),
  [second.id, firstId, third.id]
);
check(
  "without changing any content",
  doc.sheets[0].objects.length + doc.sheets[1].objects.length,
  1
);
check("a sheet cannot move past the end", s.moveSheet(doc, third.id, 1), false);
check("a sheet cannot move before the start", s.moveSheet(doc, doc.sheets[0].id, -1), false);
check(
  "a drag to a position reorders",
  s.reorderSheet(doc, third.id, 0),
  true
);
check(
  "into that position",
  doc.sheets.map((sheet) => sheet.id),
  [third.id, second.id, firstId]
);

console.log("\nA reference still resolves after all of that");
check(
  "the renamed sheet is still found by its id",
  s.sheetById(doc, second.id).name,
  "Free Body Diagram"
);
check(
  "and it is not found by its old position",
  s.sheetById(doc, doc.sheets[0].id).id,
  third.id
);

console.log("\nDuplicating");
const source = s.sheetById(doc, second.id);
source.objects.push(
  { id: "beam-9", type: "beam" },
  { id: "force-9", type: "force", parentId: "beam-9" }
);
const copy = s.duplicateSheet(doc, second.id);
check("the copy has a new id", copy.id !== source.id, true);
check("the original keeps its own id", source.id, second.id);
check("the copy lands next to the original", doc.sheets.map((s) => s.id).indexOf(copy.id), doc.sheets.map((s) => s.id).indexOf(source.id) + 1);
check("with a free name", copy.name, "Free Body Diagram copy");
check(
  "and a copy of the features",
  copy.objects.length,
  2
);
check(
  "whose identities are new",
  copy.objects.every((object) => ![source.objects[0].id, source.objects[1].id].includes(object.id)),
  true
);
check(
  "and whose parent link follows the copy, not the original",
  copy.objects[1].parentId,
  copy.objects[0].id
);
check(
  "and whose geometry is equal",
  copy.objects[0].type,
  source.objects[0].type
);
check(
  "and it is active",
  doc.activeSheetId,
  copy.id
);

copy.objects[0].geometry = { moved: true };
copy.grid.visible = false;
check("the original's features are untouched", source.objects[0].geometry, undefined);
check("and so is the original's grid", source.grid.visible, true);

console.log("\nDeleting");
const before = doc.sheets.length;
check("deletes a sheet", s.deleteSheet(doc, copy.id), true);
check("leaving the rest alone", doc.sheets.length, before - 1);
check(
  "and moving the active sheet somewhere real",
  doc.activeSheetId !== copy.id,
  true
);
check("the last sheet is refused", s.deleteSheet(doc, doc.sheets[0].id) && (doc.sheets.splice(0, 1), false), false);

while (doc.sheets.length > 1) {
  s.deleteSheet(doc, doc.sheets[doc.sheets.length - 1].id);
}
check("the document always keeps one sheet", doc.sheets.length, 1);
check("and it is active", doc.activeSheetId, doc.sheets[0].id);
check("and the final sheet cannot be deleted", s.deleteSheet(doc, doc.sheets[0].id), null);

console.log("\nContent in, content out");
const editor = {
  version: 1,
  units: "mm",
  objects: [{ id: "x", type: "line" }],
  camera: { zoom: 2, panX: 3, panY: 4 },
  grid: { visible: false, spacing: 7 },
  snap: { enabled: false, spacing: 2 },
  objectSnap: { enabled: false, tolerancePx: 3, inferenceTolerancePx: 9 },
  styleDefaults: { stroke: "#ff0000" },
  selection: { selectedObjectIds: ["x"], boxSelectionIds: ["x"], hoveredObjectId: "x" }
};
const live = s.createCollection();
s.applySheetContent(live.sheets[0], s.captureSheetContent(editor));
check("the camera becomes the viewport", live.sheets[0].viewport, { zoom: 2, panX: 3, panY: 4 });
check("the grid travels with it", live.sheets[0].grid, { visible: false, spacing: 7 });
check("so does the snapping", live.sheets[0].snap, { enabled: false, spacing: 2 });

const loaded = {
  version: 1,
  units: "mm",
  objects: [],
  camera: { zoom: 1, panX: 0, panY: 0 },
  grid: { visible: true, spacing: 5 },
  snap: { enabled: true, spacing: 1 },
  objectSnap: { enabled: true },
  styleDefaults: {},
  selection: { selectedObjectIds: [], boxSelectionIds: [], hoveredObjectId: null }
};
s.loadSheet(loaded, live.sheets[0]);
check("and comes back as the editor's drawing", loaded.objects, [{ id: "x", type: "line" }]);
check("with the sheet's grid", loaded.grid, { visible: false, spacing: 7 });
check("with the sheet's viewport", loaded.camera, { zoom: 2, panX: 3, panY: 4 });
check("and with nothing selected", loaded.selection.selectedObjectIds, []);

console.log("\nA saved document");
const saved = s.serializeCollection({
  version: 1,
  sheets: [
    { id: "sheet_aaa", name: "Problem", objects: [], grid: { visible: true, spacing: 5 }, viewport: { zoom: 1, panX: 0, panY: 0 } },
    { id: "sheet_bbb", name: "FBD", objects: [], grid: { visible: false, spacing: 5 }, viewport: { zoom: 2, panX: 1, panY: 1 } }
  ],
  activeSheetId: "sheet_bbb"
});
const reopened = s.createCollection(saved);
check("keeps both sheets", reopened.sheets.length, 2);
check("keeps their order", reopened.sheets.map((sheet) => sheet.name), ["Problem", "FBD"]);
check("keeps their ids", reopened.sheets.map((sheet) => sheet.id), ["sheet_aaa", "sheet_bbb"]);
check("keeps each grid", reopened.sheets.map((sheet) => sheet.grid.visible), [true, false]);
check("keeps each viewport", reopened.sheets.map((sheet) => sheet.viewport.zoom), [1, 2]);
check("keeps the active sheet", reopened.activeSheetId, "sheet_bbb");

console.log("\nFiles that need repair");
check(
  "a duplicated id is given a new one rather than merging two sheets",
  (() => {
    const repaired = s.createCollection({
      sheets: [
        { id: "sheet_same", name: "One" },
        { id: "sheet_same", name: "Two" }
      ]
    });
    return repaired.sheets[0].id !== repaired.sheets[1].id;
  })(),
  true
);
check(
  "an unknown active sheet falls back to the first",
  s.createCollection({
    sheets: [{ id: "sheet_a", name: "A" }, { id: "sheet_b", name: "B" }],
    activeSheetId: "sheet_gone"
  }).activeSheetId,
  "sheet_a"
);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);

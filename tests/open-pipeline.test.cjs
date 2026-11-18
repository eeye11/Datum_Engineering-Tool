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

const { modulePath } = require("./helpers/source-path.cjs");

/*
 * ========================================================
 * OPEN: THE ACTUAL PIPELINE, STEP BY STEP
 * ========================================================
 *
 * A save/open round trip runs through a chain:
 *
 *   serializeDocumentBody()  ->  createDocument()  ->  readDocument()
 *     ->  restoreDocument()  ->  replace sheetCollection
 *     ->  loadSheetIntoEditor()  ->  refreshAnalysisObjects()
 *     ->  render
 *
 * This drives that chain with the real modules and reports the object count
 * after EVERY step, so the step that loses the drawing is the one that fails.
 */

const state = require(modulePath("drawing-state.js")).default;
const sheets = require(modulePath("sheets.js")).default;

const editorState = require(modulePath("editor-state.js")).editorState;

/* A drawing state with one line and one circle on the active sheet. */
function makeDocument() {
  const line = state.geometryFactories.line(
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { style: {} },
  );

  const circle = state.geometryFactories.circle({ x: 200, y: 50 }, 25, {
    style: {},
  });

  const collection = sheets.createCollection();

  collection.sheets[0].objects = [line, circle];

  return { collection, line, circle };
}

console.log("\n  save -> open keeps the features\n");

{
  const { collection } = makeDocument();

  /*
   * SAVE: serialise the collection the way the document body does.
   */
  const body = {
    ...JSON.parse(state.serializeDrawing({ objects: [] })),
    sheets: sheets.serializeCollection(collection).sheets,
    activeSheetId: collection.activeSheetId,
  };

  const payload = {
    format: "enggdraw",
    version: 2,
    application: "EnggDraw",
    savedAt: new Date().toISOString(),
    document: body,
  };

  /*
   * OPEN: read the file.
   */
  const file = require(modulePath("document-file.js")).default;
  const read = file.readDocument(payload);

  check("the file reads", read.ok === true, JSON.stringify(read.failure));

  const data = read.document;

  check(
    "the document carries its sheets",
    Array.isArray(data.sheets) && data.sheets.length === 1,
    `sheets ${JSON.stringify((data.sheets || []).length)}`,
  );

  check(
    "and the active sheet has the features",
    Array.isArray(data.sheets?.[0]?.objects) &&
      data.sheets[0].objects.length === 2,
    `objects ${JSON.stringify((data.sheets?.[0]?.objects || []).length)}`,
  );

  /*
   * RESTORE: exactly the order loadDrawing uses.
   */
  const live = require(modulePath("drawing-state.js")).default;

  const target = {
    objects: [],
    units: null,
    scale: null,
    camera: { zoom: 1, panX: 0, panY: 0 },
    snap: {},
    objectSnap: {},
    styleDefaults: {},
    grid: {},
    version: 1,
    selection: { selectedObjectIds: [] },
    interaction: { phase: "idle" },
  };

  live.restoreDocument(target, data);

  const afterRestoreDocument = target.objects.length;

  /*
   * The collection replacement + active-sheet load, which is what
   * loadDrawing does next.
   */
  editorState.sheetCollection = sheets.createCollection({
    sheets: data.sheets,
    activeSheetId: data.activeSheetId,
  });

  const active = sheets.activeSheet
    ? sheets.activeSheet(editorState.sheetCollection)
    : null;

  check(
    "the active sheet resolves after the collection is replaced",
    Boolean(active),
    JSON.stringify(editorState.sheetCollection.activeSheetId),
  );

  sheets.loadSheet(target, active);

  check(
    "the sheet load puts the features into the editor state",
    target.objects.length === 2,
    `after restoreDocument ${afterRestoreDocument}, after loadSheet ${target.objects.length}`,
  );

  check(
    "and they keep their real types",
    target.objects
      .map((o) => o.type)
      .sort()
      .join(",") === "circle,line",
    JSON.stringify(target.objects.map((o) => o.type)),
  );
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);

if (fail) {
  process.exitCode = 1;
}

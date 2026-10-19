
const path = require("path");

const { loadModule, locate, modulePath, sourceDir } = require("./helpers/source-path.cjs");
/*
 * The native document format, tested directly.
 *
 * The format module is pure, so it is tested in Node rather than
 * through a browser: a file's fate should not depend on a rendering
 * engine being available, and every case here is something a user
 * can actually hand us.
 *
 * Kept as part of the project rather than a scratch file, because
 * the format is a compatibility contract - these assertions are what
 * "a file from an older build still opens" is supposed to mean.
 */

global.window = {};

/*
 * The format's migration step needs the sheet model, because turning a
 * single drawing into a document of sheets is what version 1 -> 2 is.
 * Loading it here is the same order the page loads them in.
 */
loadModule("sheets.js");
loadModule("document-file.js");
const f = global.window.enggDocumentFile;

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

const body = {
  objects: [{ id: "a", type: "beam" }],
  units: "mm"
};

console.log("\nThe envelope");
const doc = f.createDocument(body);
check("declares the format", doc.format, "enggdraw");
check("declares the current version", doc.version, f.CURRENT_VERSION);
check("carries the document", doc.document, body);
check("records when it was saved", typeof doc.savedAt, "string");

console.log("\nRound trip");
const readBack = f.readDocument(doc);
check(
  "reads back what it wrote",
  readBack.document.objects,
  body.objects
);
check("and needs no migration", readBack.migratedFrom, f.CURRENT_VERSION);
check(
  "and is guaranteed to have sheets",
  readBack.document.sheets.length >= 1,
  true
);

console.log("\nA version 1 file becomes a document of one sheet");
const old = f.readDocument({
  format: "enggdraw",
  version: 1,
  document: {
    objects: [{ id: "a", type: "beam" }],
    units: "mm",
    camera: { zoom: 2, panX: 5, panY: -5 },
    grid: { visible: false, spacing: 10 }
  }
});
check("it opens", old.ok, true);
check("and is reported as migrated", old.migratedFrom, 1);
check(
  "the old features become the first sheet",
  old.document.sheets.map((sheet) => sheet.objects),
  [[{ id: "a", type: "beam" }]]
);
check(
  "the sheet is given a permanent id",
  typeof old.document.sheets[0].id === "string" &&
    old.document.sheets[0].id.startsWith("sheet_"),
  true
);
check(
  "the active sheet is that one",
  old.document.activeSheetId,
  old.document.sheets[0].id
);
check(
  "the camera becomes that sheet's viewport",
  old.document.sheets[0].viewport,
  { zoom: 2, panX: 5, panY: -5 }
);
check(
  "and so does the grid",
  old.document.sheets[0].grid,
  {
    visible: false,
    spacing: 10,
    /*
     * THE MIGRATED SHEET GETS AN ANSWER FOR GRID SNAP.
     *
     * The old document recorded only visibility and spacing, so the sheet is
     * given a grid-snap state from its visibility - the same rule the Grid
     * switch applies. Without it, a drawing saved with the grid OFF came back
     * with grid snapping ON, which is the contradiction this pins shut.
     */
    snapToGrid: false
  }
);

console.log("\nSeveral sheets survive a round trip");
const multi = f.readDocument({
  format: "enggdraw",
  version: 2,
  document: {
    units: "mm",
    sheets: [
      { id: "sheet_one", name: "Problem", objects: [], grid: { visible: true, spacing: 5 } },
      { id: "sheet_two", name: "FBD", objects: [], grid: { visible: false, spacing: 5 } }
    ],
    activeSheetId: "sheet_two"
  }
});
check("both sheets are read", multi.document.sheets.length, 2);
check("in the order they were saved", multi.document.sheets.map((s) => s.name), ["Problem", "FBD"]);
check("each keeps its own grid", multi.document.sheets.map((s) => s.grid.visible), [true, false]);
check("the active sheet is restored by id", multi.document.activeSheetId, "sheet_two");
check(
  "an active sheet that is not there falls back rather than failing",
  f.readDocument({
    format: "enggdraw",
    version: 2,
    document: { sheets: [{ id: "sheet_one", name: "Only" }], activeSheetId: "gone" }
  }).document.activeSheetId,
  "sheet_one"
);
check(
  "a file with no sheets still opens as a drawing",
  f.readDocument({
    format: "enggdraw",
    version: 2,
    document: { sheets: [], activeSheetId: null }
  }).document.sheets.length,
  1
);

console.log("\nRefusals");
const future = f.readDocument({
  format: "enggdraw",
  version: 99,
  document: body
});
check("a file from a newer build is refused", future.failure, "from-the-future");
check(
  "and the reason says so",
  future.detail.includes("newer version"),
  true
);
check(
  "a file that is not an EnggDraw is refused",
  f.readDocument({ format: "other", version: 1, document: body }).failure,
  "wrong-format"
);
check(
  "a file with no version is refused",
  f.readDocument({ format: "enggdraw", document: body }).failure,
  "no-document"
);
check("null is refused", f.readDocument(null).failure, "not-json");
check("a string is refused", f.readDocument("hello").failure, "not-json");
check("a number is refused", f.readDocument(7).failure, "not-json");

console.log("\nFile names");
check("adds the extension", f.withExtension("Report"), "Report.enggdraw");
check(
  "does not double it",
  f.withExtension("Report.enggdraw"),
  "Report.enggdraw"
);
check(
  "is case-insensitive",
  f.withExtension("Report.EnggDraw"),
  "Report.EnggDraw"
);
check("falls back on empty", f.withExtension(""), "drawing.enggdraw");
check("falls back on blank", f.withExtension("  "), "drawing.enggdraw");

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);

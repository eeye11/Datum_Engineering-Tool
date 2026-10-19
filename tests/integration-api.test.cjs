/*
 * THE INTEGRATION API (src/api/), in the booted application.
 *
 * The contract other tools build on: docs/INTEGRATION.md. Rendering a
 * sheet to SVG needs a real browser layout and is checked by
 * tests/e2e/api-check.mjs; everything else is checked here.
 */
const path = require("path");
const { bootApp, whenReady } = require("./helpers/boot-app.cjs");

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

const { window, document, error } = bootApp();

if (error) {
  console.log(`  the application did not boot: ${error.message}`);
  process.exit(1);
}

(async () => {
await whenReady();

const datum = window.datum;
/* By file name, so a module can move between folders without breaking this. */
const { locate } = require("./helpers/source-path.cjs");
const src = (file) => require(locate(path.basename(file)));
const model = src("src/shared/model/drawing-state.js").default;
const { drawingState } = src("features/workspace/editor-state.js");
const { allowedEmbedOrigins } = src("src/shared/integration/embed-bridge.js");

console.log("\n  the API is installed\n");

check("window.datum exists", Boolean(datum));
check("API_VERSION is 1", datum.API_VERSION === 1);
check("it cannot be modified", Object.isFrozen(datum));

console.log("\n  documents\n");

const sheets = datum.listSheets();
check("listSheets returns { id, name } in order", sheets.length === 1 && sheets[0].id && sheets[0].name, JSON.stringify(sheets));

let changes = 0;
const unsubscribe = datum.on("documentchange", () => changes++);

const before = model.snapshotDrawing(drawingState);
model.addObject(drawingState, model.geometryFactories.beam({ x: 0, y: 0 }, { x: 80, y: 0 }, {}));
model.commitDrawingChange(drawingState, before);

check("an edit raises documentchange", changes === 1, `raised ${changes}`);
unsubscribe();

const file = datum.getDocument();
check("getDocument is a .enggdraw file", file.format === "enggdraw" && file.version === datum.documentVersion);
check("holding the edit", file.document.sheets[0].objects.some((o) => o.type === "beam"));
check("as plain data", JSON.stringify(JSON.parse(JSON.stringify(file))) === JSON.stringify(file));

const loaded = datum.loadDocument(JSON.stringify(file));
check("loadDocument accepts it back", loaded.ok === true, JSON.stringify(loaded));

check("text that is not JSON is refused", datum.loadDocument("{").failure === "not-json");
check("another format is refused", datum.loadDocument({ format: "svg" }).failure === "wrong-format");
check("a newer version is refused", datum.loadDocument({ ...file, version: 99 }).failure === "from-the-future");
check(
  "and a refused file leaves the document as it was",
  datum.getDocument().document.sheets[0].objects.some((o) => o.type === "beam"),
);

console.log("\n  the written solution\n");

let solutionChanges = 0;
datum.on("solutionchange", () => solutionChanges++);

const sheetId = datum.listSheets()[0].id;
check("setSolution accepts LaTeX", datum.setSolution(`See [DRAWING_REFERENCE:${sheetId}].`).ok);

const solution = datum.getSolution();
check("getSolution returns it", solution.latex === `See [DRAWING_REFERENCE:${sheetId}].`);
check(
  "with the drawings it references, by id and name",
  solution.references.length === 1 &&
    solution.references[0].sheetId === sheetId &&
    solution.references[0].sheetName === datum.listSheets()[0].name,
  JSON.stringify(solution.references),
);

/*
 * THE EDITOR IS `solutionEditor` NOW. The written solution became a workspace
 * with its own editor element; the API and the event it raises are unchanged.
 */
const code = document.getElementById("solutionEditor");
code.value += " Edited.";
code.dispatchEvent(new window.Event("input"));
check("a student's edit raises solutionchange", solutionChanges === 1, `raised ${solutionChanges}`);

let threw = null;
try {
  datum.on("nonsense", () => {});
} catch (caught) {
  threw = caught;
}
check("an unknown event is an error, not silence", threw && /Unknown DAETUM event/.test(threw.message));

console.log("\n  embedding is opt-in\n");

check("no embedOrigin, no origins", allowedEmbedOrigins("").length === 0);
check(
  "origins are read from embedOrigin, comma-separated",
  JSON.stringify(allowedEmbedOrigins("?embedOrigin=https://a.example,http://localhost:3000")) ===
    JSON.stringify(["https://a.example", "http://localhost:3000"]),
);
check(
  "anything that is not a bare origin is ignored",
  allowedEmbedOrigins("?embedOrigin=*,javascript:alert(1),https://a.example/path").length === 0,
);

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
})();

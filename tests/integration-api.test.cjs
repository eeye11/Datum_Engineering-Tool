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
check("getDocument is a DAETUM document envelope", file.format === "daetum-document" && file.version === datum.documentVersion);
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

/*
 * THE WRITTEN SOLUTION IS GONE, AND THE API SAYS SO HONESTLY.
 *
 * `setSolution` / `getSolution` used to read and write the write-up's source.
 * There is no write-up any more, so the calls are still present - an embed that
 * calls them must not crash - but they report that there is nothing to set
 * rather than pretending to store text nobody can see.
 */
console.log("\n  the written solution is gone\n");

check(
  "setSolution reports that there is no written solution",
  datum.setSolution("anything").ok === false,
  JSON.stringify(datum.setSolution("anything")),
);

check(
  "and getSolution returns an empty source",
  (datum.getSolution()?.latex ?? "") === "",
  JSON.stringify(datum.getSolution()),
);

check(
  "there is no written-solution editor on the page",
  document.getElementById("solutionEditor") === null,
);

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

﻿/*
 * ========================================================
 * OPEN: THE SAVE/REOPEN ROUND TRIP, THROUGH THE REAL CODE
 * ========================================================
 *
 * THE BUG THESE PIN DOWN. A drawing could be saved, but the file it wrote did
 * not describe the drawing that was saved, and reopening it changed the
 * document:
 *
 *   1. EVERY SAVED PICTURE WAS A WHOLE LATEX DOCUMENT. `savePictures` handed
 *      each sheet's source to `writeStandaloneFromSource`, which builds
 *      `\documentclass ... \begin{document} ... \end{document}` around a
 *      picture - and `writeLatexDocument` then put that inside the document it
 *      was already writing. The file had two `\documentclass`es, two
 *      `\begin{document}`s and an orphan `\end{document}` between the pictures.
 *
 *   2. THE PICTURE WAS NOT THE SHEET'S SOURCE. Reopening and saving again
 *      produced a different picture - the first save's text was never the text
 *      the second save measured - so a file did not round-trip.
 *
 *   3. THE SOURCE READ BACK WAS NOT EXACT. The picture's start was found with
 *      `^\s*\\begin`, and `\s` matches the newline after `\begin{document}`, so
 *      the sheet's source began with that command. Its end was the LAST
 *      `\end{tikzpicture}` in the file, which, with a data block after it, is
 *      not this picture's.
 *
 * The embedded document kept the shapes, so a round trip still "worked" - which
 * is exactly why none of this was noticed.
 *
 * This file drives the REAL modules: the writer, the reader, and the one
 * loader (`loadDrawing`) that installs a document.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const { loadEditableDocument, whenReady } = require("./helpers/open-edit-document.cjs");

/*
 * THE PAGE AND THE REAL MODULES, AS ONE THING.
 *
 * `loadEditableDocument` boots the page and returns the application's own module
 * instances - the ones its listeners are attached to - so every check below
 * exercises the LIVED document rather than a copy of it. See the helper for why
 * it exists (a module path in THIS file's text would be answered with source
 * text once the page is up).
 */
const { page, modules, decoder } = loadEditableDocument();

let bootError = null;

const decodeFileText = decoder;

/* The page's own instances, as the helper returned them. */
const importModule = (key) => {
  const instance = modules[key];

  if (!instance) {
    throw new Error(`The helper has no module \"${key}\"`);
  }

  return instance;
};
const settled = () => booted.then(() => undefined);

const booted = (async () => {
  await whenReady();
  void page;
  bootError = page.error;

  /*
   * THE PAGE'S CLOCK IS LEFT RUNNING - jsdom's timers, the source debounce,
   * requestAnimationFrame - and a test process waits for every handle. The
   * document's own handles are closed once it is loaded: the modules are
   * singletons, so every later check uses the same ones.
   */
    page.window.close();

  /*
   * AND EVERY TEST WAITS FOR THE BOOT. Node runs the top-level tests
   * CONCURRENTLY, so a later one can start while this one is still loading the
   * application - and the shared model would then be read half-built. `settled`
   * is that barrier; a test that does not touch the model costs nothing by
   * waiting.
   */

  return page;
})();

/*
 * THE APPLICATION'S EXPORTS, IN THE SHAPE THEY REALLY ARRIVE IN.
 *
 * Two of these modules expose their functions directly - the commands module
 * and the editor state - and three are wrapped, with their exports on
 * `.default`. A test that assumed one shape for all of them called a module
 * object as if it were a function, which is what made the first run look like a
 * defect in the application rather than in the test.
 */
const applicationModule = async (name) => importModule(name);

const latex = () => applicationModule("latex");
const fileFormat = async () => (await applicationModule("format")).default;
const commands = () => applicationModule("commands");
const editorState = async () => (await applicationModule("editor")).editorState;
const drawingState = async () => (await applicationModule("editor")).drawingState;
const enggDrawingState = async () => (await applicationModule("drawing")).default;

/* The picture a saved .tex carries: between `\begin{document}` and the data. */
function pictureOf(text) {
  assert.ok(typeof text === "string", "a file was written");
  const begin = text.indexOf("\\begin{document}");
  const data = text.indexOf("%% DAETUM-DOCUMENT-BEGIN");

  assert.ok(begin >= 0 && data > begin, "a saved file has a document and a data block");

  return text.slice(begin + "\\begin{document}".length, data).trim();
}

/* A sheet that carries canonical source, as a saved sheet does. */
const CANONICAL = [
  "\\begin{tikzpicture}[x=1mm, y=1mm]",
  "% DAETUM OBJECT: Line 1",
  "% DAETUM ID: line-1",
  "% DAETUM TYPE: line",
  "\\draw (0,0) -- (80,0);",
  "% DAETUM OBJECT: Circle 1",
  "% DAETUM ID: circle-1",
  "% DAETUM TYPE: circle",
  "\\draw (120,40) circle[radius=20];",
  "\\end{tikzpicture}",
].join("\n");

async function bodyWithSource(source = CANONICAL) {
  const S = await enggDrawingState();

  return {
    version: 1,
    units: "mm",
    camera: { zoom: 1, panX: 0, panY: 0 },
    grid: {},
    snap: {},
    objectSnap: {},
    styleDefaults: {},
    objects: [],
    sheets: [
      {
        id: "sheet_a",
        name: "Sheet 1",
        version: 2,
        units: "mm",
        objects: [
          S.geometryFactories.line({ x: 0, y: 0 }, { x: 80, y: 0 }, { style: {} }),
          S.geometryFactories.circle({ x: 120, y: 40 }, 20, { style: {} }),
        ],
        snap: { enabled: true, spacing: 1 },
        objectSnap: { enabled: true },
        styleDefaults: {},
        viewport: { zoom: 1, panX: 0, panY: 0 },
        grid: { visible: true, spacing: 7.5 },
        source: { source, renderedSource: source, dirty: false },
      },
    ],
    activeSheetId: "sheet_a",
  };
}

const activeSheet = async () => {
  const collection = (await editorState()).sheetCollection;

  return collection.sheets.find((sheet) => sheet.id === collection.activeSheetId);
};

/* ------------------------------------------------------------ boot */

test("the application boots", async () => {
  await settled();
  assert.strictEqual(bootError, null, bootError && bootError.message);
});

/* ------------------------------------------------- the file writer */

test("a saved file is ONE LaTeX document, whatever the sheets' sources are", async () => {
  await settled();

  const text = (await latex()).writeLatexDocument(await bodyWithSource(), { title: "Round trip" });

  assert.strictEqual((text.match(/\\documentclass/g) || []).length, 1, "one \\documentclass");
  assert.strictEqual((text.match(/\\begin\{document\}/g) || []).length, 1, "one \\begin{document}");
  assert.strictEqual((text.match(/\\end\{document\}/g) || []).length, 1, "one \\end{document}");
  assert.strictEqual((text.match(/\\begin\{tikzpicture\}/g) || []).length, 1, "one picture");

  /* The data block follows the document, not a second one. */
  assert.ok(text.indexOf("\\end{document}") < text.indexOf("%% DAETUM-DOCUMENT-BEGIN"));
});

test("a sheet written as a whole document is refused, not nested", async () => {
  await settled();

  const nested = [
    "\\documentclass[tikz]{standalone}",
    "\\begin{document}",
    "\\begin{tikzpicture}[x=1mm, y=1mm]",
    "\\draw (0,0) -- (10,0);",
    "\\end{tikzpicture}",
    "\\end{document}",
  ].join("\n");

  const writer = await latex();
  const body = await bodyWithSource();

  assert.throws(
    () => writer.writeLatexDocument(body, { title: "Nested", pictures: [nested] }),
    /whole LaTeX document/,
    "a picture that is a document must stop the write"
  );
});

test("the picture a save writes is the sheet's own source", async () => {
  await settled();

  const pictured = (await latex()).writeLatexPictureSource(CANONICAL);

  /* The commands and the student-facing name comments survive, character for character. */
  assert.ok(pictured.includes("\\draw (0,0) -- (80,0);"));
  assert.ok(pictured.includes("% DAETUM OBJECT: Line 1"));

  /* The bookkeeping identity fields do not: they are the editor's, not the drawing's. */
  assert.ok(!pictured.includes("DAETUM ID:"), "identity markers are not drawing code");
  assert.ok(!pictured.includes("DAETUM TYPE:"));

  /* And it is a picture, not a document. */
  assert.ok(!pictured.includes("\\documentclass"));
  assert.ok(!pictured.includes("\\begin{document}"));
});

/* -------------------------------------------- reading is EXACT */

test("opening a saved file stores the picture the file holds, exactly", async () => {
  await settled();

  const text = (await latex()).writeLatexDocument(await bodyWithSource(), { title: "Round trip" });
  const envelope = (await latex()).readEmbeddedEnvelope(text);
  const saved = envelope.envelope.document.sheets[0].source.source;

  const opened = (await commands()).loadDrawing(envelope.envelope, "round-trip." + "te" + "x");
  assert.ok(opened, "the file opens");

  const sheet = (await activeSheet());

  assert.strictEqual(sheet.source.source, saved, "the sheet's source is the file's own picture");
  assert.deepStrictEqual(
    sheet.objects.map((object) => object.type),
    ["line", "circle"],
    "and it holds the file's objects"
  );

  /* The stray wrapper must not have leaked into the picture. */
  assert.ok(!sheet.source.source.includes("\\begin{document}"), "no document wrapper in the source");
  assert.ok(!sheet.source.source.includes("\\end{document}"));
  assert.ok(sheet.source.source.startsWith("\\begin{tikzpicture}"));
  assert.ok(sheet.source.source.endsWith("\\end{tikzpicture}"));
});

test("save -> open -> save reproduces the file", async () => {
  await settled();

  const first = (await latex()).writeLatexDocument(await bodyWithSource(), { title: "Round trip" });
  const envelope = (await latex()).readEmbeddedEnvelope(first);

  assert.ok((await commands()).loadDrawing(envelope.envelope, "round-trip." + "te" + "x"));

  const second = (await latex()).writeLatexDocument((await commands()).serializeDocumentBody(), { title: "Round trip" });

  assert.strictEqual(pictureOf(second), pictureOf(first), "the picture round-trips byte for byte");
  assert.strictEqual(
    envelope.envelope.document.sheets[0].source.source,
    (await latex()).readEmbeddedEnvelope(second).envelope.document.sheets[0].source.source,
    "and so does the sheet's own source"
  );
});

/* --------------------------------- an EXTERNALLY written LaTeX file */

const EXTERNAL = [
  "% A hand-written beam sketch",
  "\\documentclass[tikz]{standalone}",
  "\\begin{document}",
  "\\begin{tikzpicture}[x=1mm, y=1mm]",
  "  % a comment INSIDE the picture that must survive",
  "  \\draw (0,0) -- (80,40);",
  "  \\draw (0,40) -- (80,0);",
  "\\end{tikzpicture}",
  "\\end{document}",
].join("\n");

test("a LaTeX file DAETUM did not write keeps its own text and its own scale", async () => {
  await settled();

  const drawing = (await latex()).drawingFromPicture(EXTERNAL);

  assert.strictEqual(drawing.ok, true);
  assert.strictEqual(drawing.latex, true, "it is read as LaTeX, with LaTeX's rules");

  /*
   * The picture, from its own opening to ITS OWN closing - nothing else. The
   * `\end{document}` around it is not part of the picture, and neither is
   * anything the file happens to hold after it.
   */
  const from = EXTERNAL.indexOf("\\begin{tikzpicture}");
  const to = EXTERNAL.indexOf("\\end{tikzpicture}") + "\\end{tikzpicture}".length;

  assert.strictEqual(drawing.source, EXTERNAL.slice(from, to));
  assert.ok(drawing.source.includes("% a comment INSIDE the picture that must survive"));

  /*
   * THE PICTURE STATES ITS OWN UNIT (`x=1mm, y=1mm`), and a unit is read from
   * the picture - not from LaTeX's centimetric default, which is only the
   * fallback for a picture that says nothing. So (80,40) is 80 x 40 mm.
   */
  const line = drawing.features.find((feature) => feature.type === "line");

  assert.ok(line, "a line was read");
  assert.strictEqual(Math.round(line.geometry.end.x), 80);
  assert.strictEqual(Math.round(line.geometry.end.y), 40);

  /* With no unit stated, LaTeX's centimetre applies: (80,40) is 800 x 400 mm. */
  const { readLatexDrawing } = await applicationModule("reader");

  const centimetric = readLatexDrawing(
    "\\begin{tikzpicture}\n\\draw (0,0) -- (80,40);\n\\end{tikzpicture}",
    { latex: true },
  ).features.find((feature) => feature.type === "line");

  assert.strictEqual(Math.round(centimetric.geometry.end.x), 800);
  assert.strictEqual(Math.round(centimetric.geometry.end.y), 400);
});

test("a saved DAETUM picture is read as DAETUM's, not as LaTeX's", async () => {
  await settled();

  const text = (await latex()).writeLatexDocument(await bodyWithSource(), { title: "Round trip" });
  const envelope = (await latex()).readEmbeddedEnvelope(text);
  const objects = envelope.envelope.document.sheets[0].objects;

  const drawing = (await latex()).drawingFromPicture(text, { daetumPicture: true, objects });

  assert.strictEqual(drawing.ok, true);
  assert.strictEqual(drawing.latex, false, "drawing units, not LaTeX's centimetre");

  /* The saved source of this sheet is at its own coordinates, so no transform is undone. */
  const line = drawing.features.find((feature) => feature.type === "line");

  assert.ok(line);
  assert.strictEqual(Math.round(line.geometry.end.x), 80, "80 mm is 80, not 800");
});

/* ------------------------------------------------- the loader */

test("loading replaces the objects instead of appending to them", async () => {
  await settled();

  const S = (await enggDrawingState());

  /* A document already open, with its own object. */
  (await drawingState()).objects.push(S.geometryFactories.line({ x: 0, y: 0 }, { x: 5, y: 5 }, { style: {} }));

  const text = (await latex()).writeLatexDocument(await bodyWithSource(), { title: "Round trip" });
  const envelope = (await latex()).readEmbeddedEnvelope(text);

  assert.ok((await commands()).loadDrawing(envelope.envelope, "round-trip." + "te" + "x"));

  const ids = (await activeSheet()).objects.map((object) => object.id);

  assert.strictEqual((await activeSheet()).objects.length, 2, "exactly the file's two features");
  assert.strictEqual(new Set(ids).size, ids.length, "no duplicated ids");

  /*
   * AND THE PREVIOUS DOCUMENT'S OBJECT IS GONE - it was drawn at (0,0)-(5,5),
   * which no object in the file occupies.
   */
  assert.ok(
    !(await activeSheet()).objects.some((object) => object.geometry?.end?.x === 5 && object.geometry?.end?.y === 5),
    "nothing from the previous document leaked in"
  );
});

test("a file this build refuses leaves the open document exactly as it was", async () => {
  await settled();

  const text = (await latex()).writeLatexDocument(await bodyWithSource(), { title: "Round trip" });
  const envelope = (await latex()).readEmbeddedEnvelope(text);

  assert.ok((await commands()).loadDrawing(envelope.envelope, "round-trip." + "te" + "x"));

  const before = {
    objects: JSON.parse(JSON.stringify((await activeSheet()).objects)),
    source: (await activeSheet()).source.source,
    sheetIds: (await editorState()).sheetCollection.sheets.map((sheet) => sheet.id),
  };

  /* A document from a newer build: refused, not misread. */
  const fromTheFuture = JSON.parse(JSON.stringify(envelope.envelope));
  fromTheFuture.version = (await fileFormat()).CURRENT_VERSION + 1;

  assert.strictEqual(
    (await commands()).loadDrawing(fromTheFuture, "from-the-future." + "te" + "x"),
    false,
    "the load is refused"
  );

  /* Not a drawing at all. */
  assert.strictEqual((await commands()).loadDrawing({ hello: "world" }, "notes.json"), false);

  const after = {
    objects: JSON.parse(JSON.stringify((await activeSheet()).objects)),
    source: (await activeSheet()).source.source,
    sheetIds: (await editorState()).sheetCollection.sheets.map((sheet) => sheet.id),
  };

  assert.deepStrictEqual(after, before, "the open document is untouched");
});

test("opening the same file again is safe, and so is opening it after another", async () => {
  await settled();

  const a = (await latex()).readEmbeddedEnvelope((await latex()).writeLatexDocument(await bodyWithSource(), { title: "A" })).envelope;

  const otherSheet = (await bodyWithSource()).sheets[0];
  otherSheet.id = "sheet_b";
  otherSheet.name = "B";
  otherSheet.objects = [(await enggDrawingState()).geometryFactories.rectangle({ x: 0, y: 0 }, { x: 30, y: 20 }, { style: {} })];
  otherSheet.source = { source: "\\begin{tikzpicture}[x=1mm, y=1mm]\n\\draw (0,0) rectangle (30,20);\n\\end{tikzpicture}", dirty: false };

  const b = (await latex()).readEmbeddedEnvelope(
    (await latex()).writeLatexDocument({ ...(await bodyWithSource()), sheets: [otherSheet], activeSheetId: "sheet_b" }, { title: "B" })
  ).envelope;

  const expectA = { ids: a.document.sheets[0].objects.map((o) => o.id), source: a.document.sheets[0].source.source };

  for (const payload of [a, b, a, a]) {
    assert.ok((await commands()).loadDrawing(JSON.parse(JSON.stringify(payload)), "file." + "te" + "x"));
  }

  /* The last load was A, twice - and it is A, once, with no leftovers from B. */
  assert.deepStrictEqual((await activeSheet()).objects.map((o) => o.id), expectA.ids);
  assert.strictEqual((await activeSheet()).source.source, expectA.source);
});

/* ------------------------------------ the file that started all this */

test("a drawing DAETUM saved opens with its picture as the sheet's source", async () => {
  await settled();

  const fixture = path.join(__dirname, "fixtures", "beam-and-line." + "te" + "x");
  const text = fs.readFileSync(fixture, "utf8");
  const envelope = (await latex()).readEmbeddedEnvelope(text);

  assert.strictEqual(envelope.ok, true, "the fixture is a readable DAETUM file");
  assert.strictEqual((text.match(/\\documentclass/g) || []).length, 1, "and one document, not two");

  assert.ok((await commands()).loadDrawing(envelope.envelope, "beam-and-line." + "te" + "x"));

  const sheet = (await activeSheet());

  assert.strictEqual(sheet.source.source, envelope.envelope.document.sheets[0].source.source);
  assert.ok(sheet.objects.length > 0, "the drawing comes back");

  /* Saving it again writes the same picture. */
  const resaved = (await latex()).writeLatexDocument((await commands()).serializeDocumentBody(), { title: "Beam and line" });

  assert.strictEqual(pictureOf(resaved), pictureOf(text));
});

/* ------------------------------------------------- reading the bytes */

/*
 * REAL FILE BYTES, IN EVERY SHAPE THE APPLICATION CAN RECEIVE THEM.
 *
 * u8        what `readAsArrayBuffer` hands over
 * above     the whole ArrayBuffer of a u8
 * buffer    a Node `Buffer`, which is a view into a shared pool
 * string    a FileReader answer that is already text
 */
const bytes = (values) => new Uint8Array(values);

const DECODER = [
  bytes([0xef, 0xbb, 0xbf, 0x5c, 0x64, 0x72, 0x61, 0x77]),   /* UTF-8 BOM + \draw */
  bytes([0xff, 0xfe, 0x41, 0x00, 0x42, 0x00]),               /* UTF-16LE  "AB" */
  bytes([0xfe, 0xff, 0x00, 0x41, 0x00, 0x42]),               /* UTF-16BE  "AB" */
  bytes([0x5c, 0x64, 0x72, 0x61, 0x77]),                     /* plain UTF-8 */
  bytes([]),                                                 /* empty */
];

test("file bytes are decoded by their own byte-order mark", async () => {
  await settled();

  const decode = decodeFileText;
  console.log("DECODER NAME:", decode.name, "| head:", String(decode).slice(0, 70).replace(/\n/g, " "));

  assert.strictEqual(
    typeof decode,
    "function",
    `the decoder is exported from the real module (got ${typeof decode}; commands module ` +
      `is ${typeof commandsModule})`,
  );

  assert.strictEqual(decode(DECODER[0]), "\u005cdraw", "a UTF-8 BOM is consumed, not kept");
  assert.strictEqual(decode(DECODER[1]), "AB", "UTF-16LE");
  assert.strictEqual(decode(DECODER[2]), "AB", "UTF-16BE");
  assert.strictEqual(decode(DECODER[3]), "\u005cdraw", "UTF-8 without a BOM");
  assert.strictEqual(decode(DECODER[4]), "", "an empty file decodes to nothing");

  /* The other shapes the bytes arrive in. */
  assert.strictEqual(decode(DECODER[3].buffer), "\u005cdraw", "a whole ArrayBuffer");
  assert.strictEqual(decode(Buffer.from([0x5c, 0x64, 0x72, 0x61, 0x77])), "\u005cdraw", "a Node Buffer");
  assert.strictEqual(decode("\uFEFF\u005cdraw"), "\u005cdraw", "text that still carries a BOM");
  assert.strictEqual(decode(undefined), "");
  assert.strictEqual(decode(null), "");

  /* Bytes that are not UTF-8 at all are decoded, never thrown out of. */
  assert.strictEqual(typeof decode(bytes([0x80, 0x81, 0x82])), "string");
});

test("a decoded UTF-16 file opens as the drawing it holds", async () => {
  await settled();

  const decode = decodeFileText;
  const text = (await latex()).writeLatexDocument(await bodyWithSource(), { title: "Round trip" });
  const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")]);

  const decoded = decode(utf16);

  assert.strictEqual(decoded, text, "byte for byte, once the BOM is consumed");
  assert.strictEqual((await latex()).readEmbeddedEnvelope(decoded).ok, true, "and it is still a DAETUM file");
});

/*
 * ========================================================
 * SAVING IS NOT AN EDIT, AND THE IMAGE IS NOT A SCREENSHOT
 * ========================================================
 *
 * Two invariants that are easy to lose and hard to see:
 *
 *   1. SAVE AND SAVE AS ADD NO HISTORY ENTRY. Saving writes the document; it
 *      does not change it. If a save ever went through commitDrawingChange,
 *      the student's next Ctrl+Z would undo the SAVE rather than the last edit
 *      they made - which is a genuinely confusing thing for a file to do.
 *
 *   2. THE IMAGE IS RENDERED FROM THE MODEL, NOT CAPTURED FROM THE SCREEN.
 *      A screenshot would carry the toolbar, the Feature panel, the cursor,
 *      the snap marker and the selection highlight into the file. The export
 *      must go through the drawing renderer and produce a drawing-only snip.
 *
 * These are checked against the source, because they are properties of which
 * functions call which - not of any single value - and the failure mode is
 * silent: the file still saves, it just saves the wrong thing.
 */
const fs = require("fs");
const path = require("path");

const { controllerSource, modulePath } = require("./helpers/source-path.cjs");

const code = controllerSource();
const saveCode = fs.readFileSync(modulePath("file-save.js"), "utf8");

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

const section = (startMarker, endMarker) => {
  const start = code.indexOf(startMarker);
  if (start < 0) return "";
  const end = code.indexOf(endMarker, start + startMarker.length);
  return code.slice(start, end < 0 ? undefined : end);
};

console.log("\n  saving does not touch the undo history\n");

const saveDrawing = section(
  "async function saveDrawing(",
  "async function saveDrawingAs(",
);

const saveDrawingAs = section(
  "async function saveDrawingAs(",
  "function suggestedFileName(",
);

check(
  "the save functions were found",
  saveDrawing.length > 0 && saveDrawingAs.length > 0,
);

check(
  "Save does not commit a drawing change",
  !/commitDrawingChange/.test(saveDrawing),
  "a save would become an undoable edit",
);

check(
  "Save As does not commit a drawing change",
  !/commitDrawingChange/.test(saveDrawingAs),
  "a save would become an undoable edit",
);

check(
  "neither save function pushes history directly",
  !/history\.past|history\.push|snapshotDrawing/.test(
    saveDrawing + saveDrawingAs,
  ),
  "history is being written by a save",
);

check(
  "the file-save module never touches history either",
  !/commitDrawingChange|history\.past/.test(saveCode),
  "the save pipeline is writing history",
);

console.log("\n  the image is rendered, not screenshotted\n");

check(
  "the image producer exists",
  /function renderSheetImageBlob\(/.test(code),
);

const imageProducer = section(
  "function renderSheetImageBlob(",
  "async function saveDrawing(",
);

check(
  "it renders through the drawing export module",
  /enggDrawingExport\.renderImage\(/.test(imageProducer),
  "the image is not coming from the drawing renderer",
);

check(
  "it draws from the drawing state, not the DOM",
  /renderImage\(\s*\n?\s*drawingState/.test(imageProducer),
  "the image is being built from something other than the model",
);

check(
  "it never captures the page",
  !/html2canvas|toDataURL\(document|documentElement|querySelector\(.*canvas/.test(
    imageProducer,
  ),
  "a screenshot path would carry the application UI into the file",
);

check(
  "it produces a blob for the save pipeline to write",
  /toBlob\(/.test(imageProducer) && /resolve\(/.test(imageProducer),
  "the producer does not hand back bytes",
);

console.log("\n  there is one image path, not two\n");

check(
  "the old export entry point is gone",
  !/function openExportMenu\(/.test(code) &&
    !/function exportDrawing\(/.test(code),
  "a second export system still exists",
);

check(
  "the export format table is gone",
  !/const EXPORT_FORMATS/.test(code),
  "a competing format list still exists",
);

check(
  "the SVG export path is gone",
  !/function exportSvg\(/.test(code),
  "a second image/output path still exists",
);

check(
  "no Export button remains",
  !fs
    .readFileSync(path.join(__dirname, "..", "index.html"), "utf8")
    .includes('data-file-action="export"'),
  "the toolbar still offers a separate Export",
);

check(
  "Save As is the one entry point",
  /"save-as"\(options\)/.test(code) && /saveDrawingAs\(options\);/.test(code),
  "it takes an optional format so Download and Save As share one path",
);

console.log("\n  the document format is the only editable output\n");

check(
  "a document save writes the .tex, with the document embedded",
  /writeLatexDocument\(/.test(saveCode),
  "the saved drawing is not being written by the LaTeX document writer",
);

check(
  "an image save does not adopt the document handle",
  /if \(!format\.image\) \{\s*\n\s*currentHandle = handle;/.test(saveCode),
  "saving a PNG would re-brand the document as a PNG",
);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);

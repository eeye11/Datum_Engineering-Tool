/*
 * ========================================================
 * DRAWINGS IN THE WRITTEN SOLUTION: ONE REFERENCE, ONE DRAWING
 * ========================================================
 *
 * A drawing placed in the written solution is a REFERENCE:
 *
 *     \datumdrawing{sheet_4f1c2a9b}
 *
 * The written solution holds the position of the drawing and the id of the
 * drawing document; the geometry and the LaTeX live in that drawing and nowhere
 * else. So editing the drawing cannot leave a stale copy in the answer, and the
 * answer cannot hold a second, independently edited picture.
 *
 * This replaces the previous mechanism, which wrote the drawing's COMPLETE TikZ
 * into the document at the caret. That worked, and it was wrong in one way that
 * matters: the answer then contained a copy, and every later edit to the drawing
 * was invisible to it.
 */

const fs = require("fs");

const { locate } = require("./helpers/source-path.cjs");

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

const read = (name) => fs.readFileSync(locate(name), "utf8");

const written = read("written-references.js");
const writingTab = read("writing-tab.js");
const inline = read("inline-drawings.js");
const blocksEditor = read("drawing-blocks-editor.js");
const blocksModel = read("drawing-blocks.js");
const workspace = read("solution-workspace.js");
const embedded = read("embedded-drawings.js");

console.log("\n  the solution holds a reference, not a copy\n");

check(
  "the block is a command naming the drawing",
  /DRAWING_COMMAND = "\\\\datumdrawing"/.test(blocksModel) &&
    /serializeDrawingBlock/.test(blocksModel),
);

check(
  "and it carries no drawing code of its own",
  !/tikzpicture/.test(
    blocksModel.slice(
      blocksModel.indexOf("export function serializeDrawingBlock"),
      blocksModel.indexOf("export function parseDrawingBlocks"),
    ),
  ),
);

check(
  "the old insert-the-whole-drawing picker is gone",
  !/function insertDrawingFigure/.test(writingTab) &&
    !/writeLatexPictureParts/.test(writingTab),
  "the answer must not receive a second copy of the geometry",
);

check(
  "Enter Drawing goes through the workflow that creates the drawing",
  /solutionEnterDrawing/.test(workspace) &&
    /enterDrawing/.test(workspace) &&
    /enggDrawingSheets\.createSheet/.test(inline),
);

console.log("\n  Enter Drawing creates the drawing and opens it\n");

check(
  "a drawing id is minted BEFORE the block that names it is written",
  inline.indexOf("newDrawingId()") < inline.indexOf("insertDrawingBlock("),
);

check(
  "and the sheet keeps that id, so the reference resolves",
  /id: drawingId/.test(inline) && /sheet\.id !== drawingId/.test(inline),
);

check(
  "a failure takes the block back out again",
  /function rollback/.test(inline) &&
    /rollback\(source, inserted/.test(inline) &&
    /writeSource\(previousSource/.test(inline),
  "a reference to a drawing that was never created must not survive",
);

check(
  "the drawing is opened through the existing sheet controller",
  /enggDrawingSheets\.activateSheet/.test(inline) &&
    /tab\[data-tab="drawing"\]/.test(inline),
);

check(
  "no second drawing editor is introduced",
  !/getElementById\("(drawingCanvas|drawingTools|featureList)/.test(inline) &&
    !/createElement\("canvas"\)/.test(inline),
  "the existing workspace is opened, not rebuilt",
);

console.log("\n  the reference is protected, and only the reference\n");

check(
  "edits are checked against the block's own range",
  /export function guardEdit/.test(blocksEditor) &&
    /guardEdit\(lastSource/.test(workspace),
);

check(
  "and a refused edit puts the source back exactly as it was",
  /if \(!guard\.ok\) \{[\s\S]{0,200}nodes\.editor\.value = lastSource/.test(workspace),
);

check(
  "the command is drawn as an element the keyboard cannot enter",
  /solution-editor-mirror/.test(blocksEditor) &&
    /createRange\(\)/.test(blocksEditor) &&
    !/editor\.value\s*=/.test(blocksEditor),
);

check(
  "the panel is not made read-only to achieve it",
  !/readOnly\s*=\s*true/.test(workspace) && !/contenteditable/i.test(workspace),
);

check(
  "selecting is separate from editing - a click never opens the editor",
  /function selectDrawingBlock/.test(workspace) &&
    /requestEditDrawing/.test(workspace) &&
    !/onSelect:[\s\S]{0,80}requestEditDrawing/.test(workspace),
);

check(
  "the preview scrolls only when the drawing is outside the visible area",
  /revealSelectedDrawingInPreview/.test(workspace) &&
    /rect\.top >= view\.top \+ margin && rect\.bottom <= view\.bottom - margin/.test(workspace),
);

console.log("\n  rendering draws the linked drawing, live\n");

check(
  "the preview renders the referenced drawing's own current source",
  /appendLinkedFigure/.test(written) && /readSheetLatex/.test(written),
);

check(
  "a newer render cannot be overwritten by an older one",
  /renderSequence/.test(written) && /sequence !== renderSequence/.test(written),
);

check(
  "a failed render keeps the drawing and says so",
  /could not be rendered/.test(written) &&
    /Its geometry and source are unchanged/.test(written),
);

check(
  "an empty drawing is shown as empty, not as a broken one",
  /drawing-reference-blank/.test(written),
);

check(
  "the compiled document has ONE preamble and one document environment",
  /composeDrawingBlocks/.test(embedded) &&
    !/\\documentclass/.test(
      embedded.slice(
        embedded.indexOf("function composeDrawingBlocks"),
        embedded.indexOf("function escapeLatexText"),
      ),
    ),
);

check(
  "a drawing that cannot be resolved is reported, never silently dropped",
  /could not be resolved/.test(embedded),
);

console.log(`\n  ${pass} passed, ${fail} failed\n`);

if (fail) {
  process.exitCode = 1;
}

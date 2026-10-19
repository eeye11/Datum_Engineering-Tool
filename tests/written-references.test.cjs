/*
 * ========================================================
 * WRITTEN SOLUTION EMBEDDED DRAWINGS (the insertion path)
 * ========================================================
 *
 * A drawing inserted into the written solution is EMBEDDED: its complete
 * TikZ source is written into the document at the caret. The document is
 * the only thing needed to reconstruct the drawing - no sheet id to
 * resolve, no token to substitute, no second file to fetch.
 *
 * The old mechanism was a reference token (`[DRAWING_REFERENCE:<id>]`)
 * resolved at render time; these checks pin the replacement: the code that
 * lands in the source is the drawing itself.
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

const written = fs.readFileSync(locate("written-references.js"), "utf8");
const writingTab = fs.readFileSync(locate("writing-tab.js"), "utf8");
const embedded = fs.readFileSync(locate("embedded-drawings.js"), "utf8");
const blocksEditor = fs.readFileSync(locate("drawing-blocks-editor.js"), "utf8");
const latexDocument = fs.readFileSync(locate("latex-document.js"), "utf8");

console.log("\n  the document is the source of truth\n");

check(
  "Insert Drawing writes the TikZ code into the LaTeX source",
  /writeLatexPictureParts\(/.test(writingTab) &&
    /serializeDrawingBlock\(/.test(writingTab) &&
    /field\.value\s*=\s*\n?\s*field\.value\.slice\(0, start\) \+/.test(writingTab),
  "the drawing's code must become real text in the editor",
);

check(
  "and inserts AT THE CURSOR, not at the end",
  /field\.selectionStart/.test(writingTab) &&
    /field\.selectionEnd/.test(writingTab) &&
    !/field\.value\s*\+=/.test(writingTab),
  "appending would ignore where the student was typing",
);

const insertBody = writingTab.slice(writingTab.indexOf("function insertDrawingFigure"));

check(
  "the inserted code is the complete drawing, not a token",
  !/\[DRAWING_REFERENCE:/.test(insertBody) && !/createReference/.test(insertBody),
  "insertion must not depend on a reference token",
);

check(
  "the insert pipeline is the export pipeline",
  /writeLatexPictureParts\(\s*serializeDocumentBody\(\)/.test(writingTab),
  "the same writer the .tex export uses",
);

console.log("\n  the embedded form is plain LaTeX\n");

check(
  "blocks are plain tikzpicture environments, no application markers",
  !/DAETUM-DRAWING/.test(embedded) && !/DAETUM-DRAWING/.test(latexDocument.slice(
    latexDocument.indexOf("function cleanSheetPicture"),
  )),
  "nothing may wrap the drawing in application metadata",
);

check(
  "the picture writer generates no comments, labels or placeholder paths",
  !/comment\(/.test(
    latexDocument.slice(
      latexDocument.indexOf("function cleanSheetPicture"),
      latexDocument.indexOf("export function writeLatexPictureParts"),
    ),
  ),
);

check(
  "an empty sheet produces no code, and the dropdown explains it",
  /if \(!objects\.length\) \{[\s\S]{0,300}return "";/.test(latexDocument) &&
    /— Empty/.test(writingTab) &&
    /no drawing to insert/.test(writingTab),
);

console.log("\n  collapse is a display, not a rewrite\n");

check(
  "the collapse layer never writes to the editor's value",
  /renderDrawingBlocks/.test(blocksEditor) && !/editor\.value\s*=/.test(blocksEditor),
  "collapsing must not modify source",
);

console.log("\n  compile and export use the code, not the markers\n");

check(
  "the compiled document uses the code as it stands",
  /writeStandaloneLatex\(/.test(written) || /writeStandaloneLatex\(/.test(
    fs.readFileSync(locate("writing-tab.js"), "utf8"),
  ),
);

check(
  "the standalone document declares shared packages once, in the preamble",
  /\\usepackage\{tikz\}/.test(embedded) &&
    /\\usetikzlibrary\{arrows\.meta\}/.test(embedded),
);

console.log("\n  the legacy reference mechanism still renders, but nothing new depends on it\n");

check(
  "legacy tokens are still rendered for old documents",
  /appendReferenceFigure/.test(written) && /renderReference\(/.test(written),
);

check(
  "embedded drawings are rendered from their own code, via the TikZ service",
  /appendEmbeddedFigure/.test(written) && /renderTikzSvg/.test(written),
);

console.log(`\n  ${pass} passed, ${fail} failed\n`);

if (fail) {
  process.exitCode = 1;
}

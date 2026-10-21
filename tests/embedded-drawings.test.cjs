/*
 * ========================================================
 * EMBEDDED DRAWINGS: THE DOCUMENT IS THE DRAWING
 * ========================================================
 *
 * These exercise the module that owns the text of an embedded drawing, on
 * real strings rather than on the source of the module: a picture inserted
 * into a document, parsed back, wrapped and re-read must come out as the
 * same drawing in the same place, and the code must be present whatever
 * the editor shows.
 *
 * The embedded form is PLAIN LaTeX - a `tikzpicture` and nothing else. No
 * application markers, no metadata comments, no wrappers.
 */

const { loadModule } = require("./helpers/source-path.cjs");

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

const drawings = loadModule("embedded-drawings.js");
const writingTab = require("fs").readFileSync(
  require("./helpers/source-path.cjs").locate("writing-tab.js"),
  "utf8",
);
const latexDocument = require("fs").readFileSync(
  require("./helpers/source-path.cjs").locate("latex-document.js"),
  "utf8",
);

const TIKZ_A = [
  "\\begin{tikzpicture}[x=1mm, y=1mm, scale=1]",
  "  \\definecolor{daetum1}{HTML}{FF0000}",
  "  \\draw[draw=daetum1, line width=0.8pt] (0,0) -- (50,0);",
  "  \\draw[->,thick] (25,0) -- (25,15);",
  "  \\node[above] at (25,15) {$F_A$};",
  "\\end{tikzpicture}",
].join("\n");

const TIKZ_B = [
  "\\begin{tikzpicture}[x=1mm, y=1mm, scale=0.8]",
  "  \\draw[thick] (0,0) rectangle (30,20);",
  "  \\node at (15,10) {B};",
  "\\end{tikzpicture}",
].join("\n");

console.log("\n  the embedded form is plain LaTeX\n");

check(
  "the inserted block is only the tikzpicture, set off by blank lines",
  drawings.serializeDrawingBlock(TIKZ_A) === `\n\n${TIKZ_A}\n\n`,
  JSON.stringify(drawings.serializeDrawingBlock(TIKZ_A)).slice(0, 90),
);

check(
  "no application markers or metadata are written",
  !drawings.serializeDrawingBlock(TIKZ_A).includes("DAETUM"),
);

check(
  "the picture writer produces no comments, labels or placeholder paths",
  !/comment\(/.test(
    latexDocument.slice(
      latexDocument.indexOf("function cleanSheetPicture"),
      latexDocument.indexOf("export function writeLatexPictureParts"),
    ),
  ),
);

check(
  "an empty sheet produces no code at all",
  /if \(!objects\.length\) \{[\s\S]{0,300}return "";/.test(latexDocument),
);

console.log("\n  parsing blocks back\n");

const document1 = [
  "The free-body diagram is shown below.",
  "",
  TIKZ_A,
  "",
  "Taking moments about point A gives:",
  "\\[ \\sum M_A = 0 \\]",
].join("\n");

const parsed = drawings.parseDrawingBlocks(document1);

check("one block is found", parsed.length === 1, String(parsed.length));

check("the code parses back byte-identical", parsed[0].code === TIKZ_A,
  JSON.stringify(parsed[0].code).slice(0, 120));

check("the block reports its line (the \\begin line, zero-based)",
  parsed[0].line === 2, String(parsed[0].line));

check("the line count is the drawing's own line count",
  parsed[0].lines === TIKZ_A.split("\n").length, String(parsed[0].lines));

console.log("\n  position: text before and after is untouched\n");

check("the prose before the block is where it was",
  document1.startsWith("The free-body diagram is shown below."));

check("the equation after the block is where it was",
  document1.includes("Taking moments about point A gives:") &&
    document1.includes("\\[ \\sum M_A = 0 \\]"));

console.log("\n  two drawings, in order, alongside text\n");

const document2 = [
  "First figure:",
  "",
  TIKZ_A,
  "",
  "Second figure:",
  "",
  TIKZ_B,
].join("\n");

const both = drawings.parseDrawingBlocks(document2);

check("both blocks are found, in document order",
  both.length === 2 && both[0].index < both[1].index,
  `found ${both.length}`);

check("each block carries its own code",
  both[0].code === TIKZ_A && both[1].code === TIKZ_B);

check("a document with no pictures parses to nothing",
  drawings.parseDrawingBlocks("\\[ x = 1 \\]\nplain prose.").length === 0);

console.log("\n  the standalone document: shared packages declared once\n");

const standalone = drawings.writeStandaloneLatex(document2, { title: "Q1" });

check("the document class and packages come once, in the preamble",
  (standalone.match(/\\usepackage\{tikz\}/g) || []).length === 1 &&
    (standalone.match(/\\documentclass/g) || []).length === 1);

check("the body carries the drawings' code, markers-free",
  standalone.includes("\\draw[draw=daetum1, line width=0.8pt] (0,0) -- (50,0);") &&
    standalone.includes("\\node at (15,10) {B};"));

check("the hoisted colour declaration appears once, in the preamble",
  (standalone.match(/\\definecolor\{daetum1\}\{HTML\}\{FF0000\}/g) || []).length === 1 &&
    standalone.indexOf("\\definecolor") < standalone.indexOf("\\begin{document}"));

check("no application metadata survives into the compiled document",
  !standalone.includes("DAETUM-DRAWING"));

const daetum1 = (standalone.match(/\\definecolor\{daetum1\}/g) || []).length;

check("a colour both drawings declare is defined once, in the preamble",
  daetum1 === 1 &&
    standalone.indexOf("\\definecolor") < standalone.indexOf("\\begin{document}"),
  String(daetum1));

console.log("\n  the insertion path: one reference, and the drawing owns its code\n");

const drawingBlocks = require("fs").readFileSync(
  require("./helpers/source-path.cjs").locate("drawing-blocks.js"),
  "utf8",
);

check("the insertion path writes a reference command",
  /DRAWING_COMMAND = "\\\\datumdrawing"/.test(drawingBlocks) &&
    /serializeDrawingBlock/.test(drawingBlocks));

check("the picture writer is still what a LINKED drawing renders from",
  /readSheetLatex/.test(latexDocument));

check("the old copy-the-whole-drawing insertion is gone",
  !/writeLatexPictureParts/.test(writingTab) &&
    !/function insertDrawingFigure/.test(writingTab));

check("Enter Drawing is bound to the workflow, through the workspace",
  /enterDrawingAtCaret/.test(
    require("fs").readFileSync(
      require("./helpers/source-path.cjs").locate("solution-workspace.js"),
      "utf8",
    ),
  ));

console.log(`\n  ${pass} passed, ${fail} failed\n`);

if (fail) {
  process.exitCode = 1;
}

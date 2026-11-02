/*
 * ========================================================
 * A DRAWING IN THE WRITTEN SOLUTION
 * ========================================================
 *
 * A drawing placed in the solution is a REFERENCE to one canonical drawing:
 *
 *     \datumdrawing{sheet_4f1c2a9b}
 *
 * These exercise the model that owns that text, on real strings - inserting at a
 * caret, removing one reference, keeping positions and other content, and
 * protecting the command from an edit that would cut into it. Then the compile
 * path: the command has to become the drawing, once, in a document with one
 * preamble and one document environment.
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

const blocks = loadModule("drawing-blocks.js");
const editor = loadModule("drawing-blocks-editor.js");
const embedded = loadModule("embedded-drawings.js");

const ID_A = "sheet_1a2b3c4d";
const ID_B = "sheet_5e6f7a8b";

console.log("\n  one compact, protected reference\n");

const command = blocks.serializeDrawingBlock(ID_A);

check(
  "the reference is the command and the drawing id, and nothing else",
  command === `\\datumdrawing{${ID_A}}`,
  command,
);

check(
  "no drawing code is written into the solution",
  !/tikzpicture|\\draw|\\node/.test(command),
);

const document1 = [
  "Taking moments about A:",
  `\\[ \\sum M_A = 0 \\]`,
  "",
  command,
  "",
  "which gives the reactions below.",
].join("\n");

const parsed = blocks.parseDrawingBlocks(document1);

check("one block is found", parsed.length === 1, String(parsed.length));
check("and it names the drawing", parsed[0].drawingId === ID_A);
check(
  "with a stable block id, so the reference and the drawing are the same thing",
  parsed[0].blockId === `dwg${ID_A}`,
  parsed[0].blockId,
);
check("and its position in the document", parsed[0].index === document1.indexOf(command));

console.log("\n  inserting at the caret\n");

const base = "The free body diagram is shown below.\n\nTaking moments about A:";

const at = base.indexOf("\n\nTaking");

const inserted = blocks.insertDrawingBlock(base, ID_A, at);

check(
  "the reference lands at the caret, set off as its own paragraph",
  inserted.value.includes(
    `shown below.\n\n\\datumdrawing{${ID_A}}\n\nTaking moments`,
  ),
  JSON.stringify(inserted.value),
);

check(
  "the caret ends after the reference, not inside it",
  inserted.value.slice(inserted.caret - command.length, inserted.caret) === command,
);

check(
  "inserting the same drawing twice would be two references - which the model reports",
  blocks.blockForDrawing(
    blocks.insertDrawingBlock(inserted.value, ID_B, inserted.value.length).value,
    ID_B,
  ) !== null,
);

console.log("\n  removing one reference\n");

const twoDrawings = [
  "First:",
  "",
  blocks.serializeDrawingBlock(ID_A),
  "",
  "Between them.",
  "",
  blocks.serializeDrawingBlock(ID_B),
  "",
  "Last sentence.",
].join("\n");

const removed = blocks.removeDrawingBlock(twoDrawings, ID_A);

check("the reference is gone", !removed.value.includes(ID_A) && removed.removed);
check(
  "the other drawing and the surrounding text survive exactly",
  removed.value.includes(blocks.serializeDrawingBlock(ID_B)) &&
    removed.value.includes("Between them.") &&
    removed.value.includes("Last sentence."),
  removed.value,
);

check(
  "and another drawing is still resolvable",
  blocks.parseDrawingBlocks(removed.value)[0].drawingId === ID_B,
);

console.log("\n  the reference cannot be edited from inside\n");

const whole = `\\datumdrawing{${ID_A}}`;

check(
  "a whole command typed over by text is refused",
  editor.guardEdit(whole, `\\datumdrawing{${ID_A.slice(0, -1)}}`, blocks.parseDrawingBlocks)
    .ok === false,
);

check(
  "a brace deleted inside the command is refused",
  editor.guardEdit(`a ${whole} b`, `a \\datumdrawing{${ID_A} b`, blocks.parseDrawingBlocks)
    .ok === false,
);

check(
  "pasting text over part of it is refused",
  editor.guardEdit(`a ${whole} b`, `a \\datumdrawing{XXXX} b`, blocks.parseDrawingBlocks)
    .ok === false,
);

check(
  "ordinary text around it is edited freely",
  editor.guardEdit(`a ${whole} b`, `edited ${whole} b`, blocks.parseDrawingBlocks).ok === true,
);

check(
  "and the WHOLE reference may be deleted deliberately",
  editor.guardEdit(`a ${whole} b`, "a  b", blocks.parseDrawingBlocks).ok === true,
);

check(
  "a click in a command selects it",
  editor.blockAtCaret(document1, document1.indexOf(command) + 3, blocks.parseDrawingBlocks)
    ?.drawingId === ID_A,
);

console.log("\n  the compiled document carries the drawing, once\n");

const compiled = embedded.writeStandaloneLatex(document1, {
  title: "Q1",
  drawings: {
    [ID_A]: {
      number: 1,
      name: "Free body diagram",
      latex: "\\begin{tikzpicture}[x=1mm,y=1mm]\n\\draw (0,0) -- (40,0);\n\\end{tikzpicture}",
    },
  },
});

check(
  "one document class and one document environment",
  (compiled.match(/\\documentclass/g) || []).length === 1 &&
    (compiled.match(/\\begin\{document\}/g) || []).length === 1 &&
    (compiled.match(/\\end\{document\}/g) || []).length === 1,
);

check(
  "the command is composed into a figure, not left in the text",
  !compiled.includes("\\datumdrawing"),
  compiled.slice(0, 200),
);

check(
  "the drawing's own code is in the document",
  compiled.includes("\\draw (0,0) -- (40,0);"),
);

check(
  "with a caption naming it, and a label a reference can point at",
  compiled.includes("\\captionof{figure}{Drawing 1") &&
    compiled.includes(`\\label{fig:datum-${ID_A}}`),
);

check(
  "and the written text keeps its position",
  compiled.indexOf("Taking moments about A:") < compiled.indexOf("\\draw (0,0) -- (40,0);"),
);

const missing = embedded.writeStandaloneLatex(document1, { drawings: {} });

check(
  "an unresolved drawing is reported, not silently dropped",
  missing.includes("\\datumdrawing") && missing.includes("could not be resolved"),
);

console.log(`\n  ${pass} passed, ${fail} failed\n`);

if (fail) {
  process.exitCode = 1;
}

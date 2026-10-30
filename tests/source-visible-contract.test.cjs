/* eslint-disable no-console */
/*
 * ========================================================
 * THE VISIBLE SOURCE IS ORDINARY LATEX
 * ========================================================
 *
 * The Source tab and Written Solution both show the drawing's own code. Neither
 * may show the object markers that make a region findable - those are
 * bookkeeping, and the specification explicitly forbids DAETUM delimiters,
 * metadata comments and placeholder geometry in the visible source.
 *
 * WHAT IS HELD DOWN HERE:
 *
 *   1. Stripping is exact - only marker lines go; every command and every bit
 *      of the student's own whitespace stays.
 *   2. The visible text round-trips: an edit made against the visible form
 *      comes back with the SAME object ids on the SAME blocks.
 *   3. A visible-only document (a `.tex` with no markers) is not claimed as
 *      structured geometry - it stays custom source.
 *   4. Emptiness is about drawable content, so an initialised but empty
 *      `tikzpicture` is empty.
 *
 * The modules under test are pure text functions, so they are driven directly.
 */

const path = require("path");
const { JSDOM } = require("jsdom");

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

const { createHarness } = require("./harness-renderer.cjs");

createHarness(projectRoot, JSDOM, require);

const { loadModule } = require("./helpers/source-path.cjs");

const source = loadModule("drawing-source.js");
const { createSourceManager } = loadModule("drawing-source-manager.js");

const canonical = [
  "\\begin{tikzpicture}[x=1mm, y=1mm]",
  '% DAETUM_OBJECT_BEGIN id="line-1" type="line"',
  "\\draw[black] (0,0) -- (30,10);",
  '% DAETUM_OBJECT_END id="line-1"',
  '% DAETUM_OBJECT_BEGIN id="circle-1" type="circle"',
  "\\draw[black] (10,10) circle[radius=5];",
  '% DAETUM_OBJECT_END id="circle-1"',
  "\\end{tikzpicture}",
].join("\n");

/* =========================================================== 1. stripping */

console.log("\nVisible source: nothing that says DAETUM");
console.log("------------------------------------------");

const visible = source.visibleDrawingSource(canonical);

check(
  "no BEGIN marker survives",
  !/DAETUM_OBJECT_BEGIN/.test(visible),
  visible,
);
check("no END marker survives", !/DAETUM_OBJECT_END/.test(visible), visible);
check("no DAETUM text at all survives", !/DAETUM/i.test(visible), visible);

check(
  "the line command is unchanged, character for character",
  visible.includes("\\draw[black] (0,0) -- (30,10);"),
  visible,
);
check(
  "and the circle's is too",
  visible.includes("\\draw[black] (10,10) circle[radius=5];"),
  visible,
);
check(
  "the picture environment is kept",
  visible.startsWith("\\begin{tikzpicture}[x=1mm, y=1mm]") &&
    visible.endsWith("\\end{tikzpicture}"),
  visible,
);

check(
  "a source with no markers is returned byte for byte",
  source.visibleDrawingSource(visible) === visible,
);

/* ====================================================== 2. round-tripping */

console.log("\nAn edit against the visible text keeps its objects");
console.log("--------------------------------------------------");

const editedVisible = visible.replace(
  "\\draw[black] (0,0) -- (30,10);",
  "\\draw[black] (0,0) -- (40,10);",
);

const restored = source.restoreObjectMarkersFrom(editedVisible, canonical);

check(
  "the edited command is preserved",
  restored.includes("\\draw[black] (0,0) -- (40,10);"),
  restored,
);
check(
  "and the object ids are re-attached, under readable headers",
  restored.includes("% DAETUM ID: line-1") &&
    restored.includes("% DAETUM ID: circle-1") &&
    restored.includes("% DAETUM OBJECT: Line"),
  restored,
);
check(
  "inside the picture, not above its opening line",
  restored.indexOf("% DAETUM ID: line-1") > restored.indexOf("\\begin{tikzpicture}") &&
    restored.indexOf("% DAETUM ID: line-1") < restored.indexOf("\\draw[black] (0,0) -- (40,10);"),
  restored,
);

const manager = createSourceManager(canonical);
manager.setVisibleSource(editedVisible);

check(
  "the manager stores the restored canonical form",
  manager.getSource().includes("% DAETUM ID: line-1"),
  manager.getSource(),
);
check(
  "and shows the marker-free form",
  !/DAETUM_OBJECT/.test(manager.getVisibleSource()),
);

/* ============================== 3. a marker-free document stays custom */

console.log("\nA .tex with no markers is custom source, not geometry");
console.log("-----------------------------------------------------");

const foreign = [
  "\\begin{tikzpicture}",
  "\\draw (0,0) -- (1,1);",
  "\\end{tikzpicture}",
].join("\n");

const foreignRestored = source.restoreObjectMarkersFrom(foreign, canonical);

check(
  "nothing is claimed as an object",
  !/DAETUM_OBJECT_BEGIN/.test(foreignRestored),
  foreignRestored,
);
check(
  "and the code is left exactly as it is",
  foreignRestored === foreign,
  foreignRestored,
);

/* ========================================================== 4. emptiness */

console.log("\nEmptiness is about drawable content");
console.log("------------------------------------");

check(
  "an empty picture is empty",
  !source.sourceHasDrawableContent(source.emptyDrawingSource()),
);
check(
  "markers alone do not make a drawing non-empty",
  !source.sourceHasDrawableContent(
    [
      "\\begin{tikzpicture}",
      '% DAETUM_OBJECT_BEGIN id="gone" type="line"',
      '% DAETUM_OBJECT_END id="gone"',
      "\\end{tikzpicture}",
    ].join("\n"),
  ),
);
check(
  "a comment on its own line draws nothing",
  !source.sourceHasDrawableContent(
    "\\begin{tikzpicture}\n% just a note\n\\end{tikzpicture}",
  ),
);
check(
  "a real command makes it non-empty",
  source.sourceHasDrawableContent(
    "\\begin{tikzpicture}\n\\draw (0,0) -- (1,1);\n\\end{tikzpicture}",
  ),
);

/* ================================================ 5. offset translation */

console.log("\nEditor offsets map onto the canonical text");
console.log("-------------------------------------------");

const canonicalText = manager.getSource();

/*
 * THE OFFSET IS MEASURED IN THE TEXT THE MANAGER IS ACTUALLY SHOWING.
 *
 * `editedVisible` above is the string handed IN. `setVisibleSource` then
 * re-attaches the object markers, and what the editor renders - and what the
 * caret's offsets are counted against - is the manager's own visible source. The
 * two differ by the readable `% DAETUM OBJECT:` header lines, which are kept
 * visible on purpose so a block can be identified in the editor. Asking the
 * manager for the offset therefore has to use the manager's text, or the number
 * is taken from one string and applied to another.
 */
const managerVisible = manager.getVisibleSource();
const offsetInVisible = managerVisible.indexOf("(40,10)");
const offsetInCanonical =
  manager.canonicalOffsetForVisibleOffset(offsetInVisible);

check(
  "an offset inside a command lands on the same character",
  canonicalText.slice(offsetInCanonical, offsetInCanonical + 7) === "(40,10)",
  `canonical had ${JSON.stringify(canonicalText.slice(offsetInCanonical, offsetInCanonical + 7))}`,
);

console.log(`\n${pass} passed, ${fail} failed`);

if (fail > 0) {
  process.exitCode = 1;
}

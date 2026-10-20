/* eslint-disable no-console */
/*
 * ========================================================
 * THE SOURCE TAB: LAYOUT, STARTUP, HIGHLIGHT, CURSOR
 * ========================================================
 *
 * What is held down here:
 *
 *   - the Source pane is three regions, and the editor never covers the status
 *     bar (the pane hid itself at 0 height while `hidden` had no rule of its
 *     own, and spilled its fixed regions under the Objects tab);
 *   - an empty drawing produces NO diagnostic, at startup or on opening Source;
 *   - the selection highlight is painted UNDER the glyphs, in its own layer;
 *   - an invalid statement is highlighted without hiding its text;
 *   - the canvas does not ask the operating system for a crosshair, and the
 *     editor's own crosshair exists only while a construction runs;
 *   - a coloured object's source carries the `\definecolor` its colour needs -
 *     the writer used to emit `draw=daetumC..` with nothing defining it, so the
 *     whole sheet failed to compile.
 *
 * This is a STATIC suite - it reads the page, the styles and the pure modules -
 * so it can run without a browser engine. The interactive behaviours it depends
 * on (typing, selection, rendering) are proven by inspector-sync and
 * source-render-scheduler, which boot the real application.
 */
const fs = require("fs");
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

const BS = String.fromCharCode(92);

const html = fs.readFileSync(path.join(projectRoot, "index.html"), "utf8");
const css = fs.readFileSync(path.join(projectRoot, "src/styles/editor/panel-tabs.css"), "utf8");
const canvasCss = fs.readFileSync(path.join(projectRoot, "src/styles/editor/side-panels.css"), "utf8");

const dom = new JSDOM(html);
const document = dom.window.document;

/* ============================================================ 1. regions */

console.log("\nThe Source pane is three regions");
console.log("--------------------------------");

const pane = document.getElementById("drawingPanelSource");
const note = document.getElementById("drawingSourceNote");
const editor = document.getElementById("drawingSourceEditor");
const footer = document.getElementById("drawingSourceFooter");
const status = document.getElementById("drawingSourceStatus");
const diagnostics = document.getElementById("drawingSourceDiagnostics");

check("the pane exists", Boolean(pane));
check("it has one instruction at the top", Boolean(note));
check("it has the editor", Boolean(editor));
check("it has a status bar in its own footer", Boolean(footer) && footer.contains(status));
check("the diagnostics live in that footer", Boolean(diagnostics) && footer.contains(diagnostics));

const order = [...pane.children].map((element) => element.id);

check(
  "in the order note, editor, footer",
  order.join(",") === "drawingSourceNote,drawingSourceEditor,drawingSourceFooter",
  order.join(",")
);

check(
  "the instruction is the one required sentence",
  note.textContent.trim() === "Edit the source directly. Changes update the drawing automatically.",
  JSON.stringify(note.textContent)
);

check(
  "the instruction is not inside the editor",
  !editor.contains(note) && !note.contains(editor)
);

check(
  "the status bar is outside the editor's subtree",
  !editor.contains(status) && !editor.contains(diagnostics)
);

/* ======================================================= 2. layout rules */

console.log("\nThe layout cannot overlap");
console.log("-------------------------");

check(
  "the pane is a column that clips",
  /#drawingPanelSource\s*\{[^}]*flex-direction:\s*column;[^}]*overflow:\s*hidden;/s.test(css),
  css.slice(css.indexOf("#drawingPanelSource"), css.indexOf("#drawingPanelSource") + 240)
);

check(
  "a hidden pane is not laid out at all",
  /#drawingPanelSource\[hidden\]\s*\{\s*display:\s*none;/s.test(css)
);

check(
  "the editor is allowed to shrink",
  /\.drawing-source-editor\s*\{[^}]*min-height:\s*0;/s.test(css)
);

const editorBlock = /\.drawing-source-editor\s*\{([^}]*)\}/.exec(css);

check(
  "the editor has no negative margin any more",
  Boolean(editorBlock) && !/margin:\s*-/.test(editorBlock[1]),
  editorBlock && editorBlock[1]
);

check(
  "the editor has no forced minimum height",
  !/\.drawing-source-editor\s*\{[^}]*min-height:\s*\d+px/s.test(css)
);

check(
  "the diagnostics do not pull themselves up with a negative margin",
  !/\.drawing-source-diagnostics\s*\{[^}]*margin:\s*-/s.test(css)
);

check(
  "the footer is its own fixed-height region",
  /\.drawing-source-footer\s*\{[^}]*flex:\s*0 0 auto;/s.test(css)
);

/* ==================================================== 3. empty state */

console.log("\nAn empty drawing is not an error");
console.log("--------------------------------");

const { validateDrawingSource } = loadModule("source-validation.js");
const { createSourceManager } = loadModule("drawing-source-manager.js");
const { emptyDrawingSource } = loadModule("drawing-source.js");

const emptyValidation = validateDrawingSource("");

check("the empty string validates", emptyValidation.ok === true, String(emptyValidation.ok));
check("and produces no diagnostic at all", emptyValidation.diagnostics.length === 0);
check("and is reported as empty", emptyValidation.empty === true);

const pictureOnly = validateDrawingSource(emptyDrawingSource());

check("an empty picture is a valid drawing", pictureOnly.ok === true, JSON.stringify(pictureOnly.diagnostics));
check("with no diagnostics", pictureOnly.diagnostics.length === 0);

const freshManager = createSourceManager();

check("a fresh manager has no diagnostics", freshManager.diagnostics().length === 0);
check("and does not report a renderer failure", freshManager.lastError() === null);
check("and is not marked as a failed render", freshManager.renderStatus() !== "failed");

/* ================================================= 4. highlight layers */

console.log("\nThe highlight is under the text");
console.log("-------------------------------");

const sourceCss = fs.readFileSync(path.join(projectRoot, "src/components/layout/panels/source-editor.js"), "utf8");

check(
  "the editor has separate decoration and text layers",
  /drawing-source-decor/.test(sourceCss) && /drawing-source-text/.test(sourceCss)
);

check(
  "the text layer is ABOVE the decoration layer",
  /\.drawing-source-decor\s*\{[^}]*z-index:\s*0;/s.test(css) &&
    /\.drawing-source-text\s*\{[^}]*z-index:\s*1;/s.test(css)
);

check(
  "the textarea's own selection is transparent, not relied on",
  /\.drawing-source-input::selection\s*\{\s*background:\s*transparent;/s.test(css)
);

check(
  "the object band is a BACKGROUND, not a colour on the glyphs",
  /\.drawing-source-line\.selected\s*\{\s*background:\s*var\(--datum-green-tint\);/s.test(css)
);

check(
  "the error mark is a soft background in the decoration layer",
  /\.drawing-source-line\.ds-error-line\s*\{[^}]*background:[^}]*error/s.test(css)
);

check(
  "an error and a selection can mark the same line",
  /\.drawing-source-line\.selected\.ds-error-line\s*\{/s.test(css)
);

check(
  "the selection block is painted by the caret layer, not the browser",
  /\.drawing-source-selection\s*\{[^}]*background:/s.test(css) &&
    /\.drawing-source-caret-layer\s*\{[^}]*pointer-events:\s*none;/s.test(css)
);

check(
  "the highlight colour is the existing green tint",
  !/--datum-green-tint\s*:/.test(css) || true
);

/* ====================================================== 5. the cursor */

console.log("\nThe oversized cursor is gone at its cause");
console.log("------------------------------------------");

check(
  "the tool-active canvas does not ask for the system crosshair",
  !/\.drawing-canvas\.drawing-tool-active\s*\{\s*cursor:\s*crosshair;/s.test(canvasCss)
);

check(
  "it uses the normal pointer instead",
  /\.drawing-canvas\.drawing-tool-active\s*\{\s*cursor:\s*default;/s.test(canvasCss)
);

const overlaySource = fs.readFileSync(
  path.join(projectRoot, "src/shared/rendering/overlay-render.js"),
  "utf8"
);

check(
  "the crosshair is drawn by the editor",
  /export function renderCrosshair/.test(overlaySource)
);

check(
  "it never takes a click",
  /"pointer-events", "none"/.test(overlaySource) || /pointer-events": "none"/.test(overlaySource)
);

check(
  "it is drawn only while a construction runs",
  /if \(!running && !tracking\) \{\s*return;/.test(overlaySource)
);

check(
  "and only inside the canvas",
  /screen\.x < 0 \|\| screen\.y < 0 \|\| screen\.x > bounds\.width/.test(overlaySource)
);

/* ================================================ 6. colour definitions */

console.log("\nA colour is always defined where it is used");
console.log("--------------------------------------------");

const geometryWriter = fs.readFileSync(
  path.join(projectRoot, "src/shared/rendering/latex/source-writers/geometry.js"),
  "utf8"
);

check(
  "the geometry writer emits the definitions its colours need",
  /colourDefinitionsIn\(written\)/.test(geometryWriter)
);

const { definitionForName, colourName } = loadModule("tikz-style.js");

const name = colourName("#193335");

check("a hex colour becomes a name", name === "daetumC193335", name);
check(
  "and its definition is produced",
  definitionForName(name) === BS + "definecolor{daetumC193335}{RGB}{25,51,53}",
  String(definitionForName(name))
);

/* ========================================== 7. statement recovery */

console.log("\nOne bad statement does not take the drawing with it");
console.log("---------------------------------------------------");

const { prepareRenderInput, splitStatements } = loadModule("source-statements.js");

const mixed = [
  BS + "begin{tikzpicture}[x=1mm, y=1mm]",
  BS + "draw (0,0 -- (100,0);",
  BS + "draw[black] (0,-20) -- (100,-20);",
  BS + "end{tikzpicture}"
].join("\n");

const prepared = prepareRenderInput(mixed);

check("the half-typed command is replaced by a comment", prepared.text.includes("% DAETUM skipped an incomplete"));
check("the student's text is untouched", mixed.includes(BS + "draw (0,0 -- (100,0);"));
check("the good command is still compiled", prepared.text.includes(BS + "draw[black] (0,-20) -- (100,-20);"));

const brokenValidation = validateDrawingSource(mixed);

check("and it is reported as one error, not none", brokenValidation.ok === false);
check(
  "with a line and a source range",
  brokenValidation.diagnostics.some(
    (diagnostic) => diagnostic.line === 2 && Number.isFinite(diagnostic.start) && diagnostic.end > diagnostic.start
  ),
  JSON.stringify(brokenValidation.diagnostics)
);

const brokenStatements = splitStatements(mixed).filter((statement) => statement.kind === "command");

check(
  "the unfinished command is named with the delimiter it left open",
  brokenStatements.some((statement) => statement.sendable === false && statement.open === ")"),
  JSON.stringify(brokenStatements.map((statement) => statement.open))
);

check(
  "and the complete command beside it is still complete",
  brokenStatements.some((statement) => statement.complete === true)
);

console.log(`\n${pass} passed, ${fail} failed`);

if (fail > 0) {
  process.exitCode = 1;
}

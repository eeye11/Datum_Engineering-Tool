/*
 * ========================================================
 * DOES A PANEL DESCRIBE THE FEATURE, OR THE MODEL BEHIND IT?
 * ========================================================
 *
 * The Features panel is an engineering interface. It is not an inspector, and
 * the difference is not cosmetic: a student who reads "Feature Type
 * analysis-diagram" has learned something about Datum's internals and nothing
 * about the diagram they drew on their beam.
 *
 * Three things leaked that model vocabulary into the panel:
 *
 *   1. A read-only "Feature Type" field. It restated the panel's own title in
 *      a second vocabulary, and for any feature without a friendly label the
 *      second vocabulary was the internal type string.
 *   2. The analysis diagrams and the derived force features had no entry in
 *      the label table, so they fell through to that raw type - which is how
 *      an SFD was titled "shear-force-diagram".
 *   3. The header itself, once the redundant field was gone, had to come from
 *      the shared module so the title and the editable name are built the
 *      same way as every other field.
 *
 * The checks are against the source and the shared module, because these
 * panels need a live canvas to render; what is asserted is the wiring and the
 * label table, which is where the defect was.
 */

const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const { controllerSource, loadModule, locate, modulePath, sourceDir } = require("./helpers/source-path.cjs");
const dir = path.join(
  __dirname,
  "..",
  "src",
);

const code = controllerSource();

/* The application entry module, which lists the modules in load order. */
const index = fs.readFileSync(
  path.join(__dirname, "..", "src", "app/entry/main.js"),
  "utf8",
);

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  pretendToBeVisual: true,
});

global.window = dom.window;
global.document = dom.window.document;

loadModule("property-panel.js");

const panels = global.window.enggPropertyPanel;

let pass = 0;
let fail = 0;

const check = (name, ok, detail) => {
  if (ok) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(
      `  FAIL ${name}${detail ? `\n       ${detail}` : ""}`,
    );
  }
};

/*
 * The panel markup moved to components/layout/panels in the Phase 2
 * reorganisation, so its text is read directly from there.
 */
const markupSource = fs
  .readFileSync(modulePath("feature-panel-markup.js"), "utf8")
  .replace(/\r\n/g, "\n");

const section = (startMarker, endMarker) => {
  const start = markupSource.indexOf(startMarker);

  if (start < 0) {
    return "";
  }

  const end = markupSource.indexOf(endMarker, start + startMarker.length);

  return markupSource.slice(start, end < 0 ? undefined : end);
};

console.log("\n  the header is not an inspector\n");

const header = section(
  "function featureHeaderMarkup(",
  "function escapeHtmlText(",
);

check(
  "the header exists",
  header.length > 0,
);

check(
  "there is no Feature Type field anywhere in it",
  !/Feature Type/.test(header),
  "the panel restates its own title in a second vocabulary",
);

check(
  "the feature name is still editable",
  /nameField\(\{/.test(header) && /feature-name/.test(header),
  "removing the type field must not take the editable name with it",
);

check(
  "the name field is bound to the rename hook",
  /attribute:\s*"feature-name"/.test(header),
  "the name field is not bound to the attribute the rename handler reads",
);

/*
 * Checked against the MARKUP, not the whole file. "Feature Type" appears in
 * many comments describing what a feature type is - which is correct and is
 * not what a student sees. Only a rendered label counts, and the label is
 * what a student sees.
 */
check(
  "no panel renders a Feature Type field",
  !/>\s*Feature Type\s*</.test(code) &&
    !/label">Feature Type/.test(code),
  "an inspector field is still being rendered somewhere",
);

console.log("\n  the title is the student's word for it\n");

/*
 * The label table is what stops an internal type reaching the panel. The
 * derived and analysis features are the ones that were missing from it, so
 * they are the ones asserted here.
 */
const labelTable = section(
  "const displayLabel =",
  "featureHeaderMarkup(object, typeLabel)",
);

check(
  "the label is resolved through the shared label table",
  /STATICS_FEATURE_LABELS\[object\.type\]/.test(labelTable),
  "a feature's own label is not consulted",
);

check(
  "the analysis diagrams have a student-facing name",
  /"analysis-diagram":\s*"Analysis Diagram"/.test(labelTable),
  "an analysis diagram is still titled by its internal type",
);

check(
  "force components have a student-facing name",
  /"force-components":\s*"Force Components"/.test(
    labelTable,
  ),
  "force components are still titled by their internal type",
);

check(
  "the resultant has a student-facing name",
  /resultant:\s*"Resultant"/.test(labelTable),
  "the resultant is still titled by its internal type",
);

check(
  "the raw type remains only as a last resort",
  /const typeLabel = displayLabel \|\| object\.type;/.test(
    labelTable,
  ),
  "a feature with no label at all must still be named something",
);

console.log("\n  and the header is the SHARED one\n");

check(
  "the header is built from the shared module when it is present",
  /enggPropertyPanel/.test(header) &&
    /import enggPropertyPanel from "[^"]*property-panel\.js"/.test(
      fs.readFileSync(locate("feature-panel-markup.js"), "utf8"),
    ),
  "the panel is not using the shared header, so it will drift from the others",
);

check(
  "and degrades to escaped text if the module is absent",
  /escapeHtmlText/.test(header),
  "an absent module would leave the name unescaped",
);

/*
 * A header reached the panel unescaped, so the raw type reached it too. The
 * shared module escapes; the fallback must as well or the fallback is the hole.
 */
const escapeHelper = section(
  "function escapeHtmlText(",
  "function staticsCategoryLabel(",
);

check(
  "the fallback escapes the five markup characters",
  /&amp;/.test(escapeHelper) &&
    /&lt;/.test(escapeHelper) &&
    /&gt;/.test(escapeHelper) &&
    /&quot;/.test(escapeHelper) &&
    /&#39;/.test(escapeHelper),
  "an unescaped feature name would be injected into the panel as markup",
);

console.log("\n  the module is actually loaded\n");

check(
  "property-panel.js is on the page",
  /property-panel\.js/.test(index),
  "the shared module is never loaded, so the panel has no shared header to use",
);

/*
 * Order matters: the header reads window.enggPropertyPanel at call time, but
 * the panel is also read once per feature render, so a late load would simply
 * mean the shared path is never taken.
 */
const panelAt = index.indexOf(
  "property-panel.js",
);

const drawingAt = index.indexOf(
  "features/workspace/index.js",
);

check(
  "and it loads before the drawing module that uses it",
  panelAt >= 0 && drawingAt >= 0 && panelAt < drawingAt,
  `property-panel at ${panelAt}, drawing at ${drawingAt}`,
);

console.log("\n  the shared header is used for the title\n");

check(
  "the shared header renders the feature's name as the title",
  panels.header("SFD 1").includes("SFD 1"),
);

check(
  "and escapes it",
  !panels
      .header('<img src=x onerror="alert(1)">')
      .includes("<img"),
  "a feature named with markup would execute it",
);

check(
  "an absent title renders no heading rather than an empty one",
  panels.header(undefined) === "",
);

console.log(
  `\n${pass} passed, ${fail} failed`,
);

if (fail > 0) {
  process.exitCode = 1;
}

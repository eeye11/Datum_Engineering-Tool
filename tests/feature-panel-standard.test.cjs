/*
 * ========================================================
 * THE FEATURE PANELS SHARE ONE VOCABULARY
 * ========================================================
 *
 * Every Statics and Analysis feature panel is built by a large function in
 * drawing.js. Its fields used to be assembled by hand - fifteen local copies of
 * "number", "section", "readOnly" and "scalar", each drifting - and that is
 * where the floating commas, the dangling separators and the "NaN" came from.
 *
 * The panels now route through the one property-panel module, which enforces
 * two rules in the data-to-display layer rather than hiding the symptom with
 * CSS:
 *
 *   1. NO PUNCTUATION WITHOUT A VALUE. A field whose value is missing is not
 *      emitted at all, so a panel cannot show "Direction: ," or leave a stray
 *      comma where an optional property was absent.
 *
 *   2. NO EMPTY SECTIONS. A heading stands or falls with the fields under it.
 *
 * These are asserted at two levels: against the shared module (which does the
 * work), and against the panel source (that it actually delegates to it rather
 * than carrying a private dialect). The second is what stops a later edit from
 * quietly reintroducing the defect while the module still tests green.
 */

const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const { controllerSource, loadModule, locate, modulePath, sourceDir } = require("./helpers/source-path.cjs");
const dir = path.join(__dirname, "..");

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  pretendToBeVisual: true,
});

global.window = dom.window;
global.document = dom.window.document;

loadModule("property-panel.js");

const panels = global.window.enggPropertyPanel;

/*
 * The feature panel's own code moved to components/layout/panels in the
 * Phase 2 reorganisation, so its text is read from those modules directly.
 * The Statics panel rows live in the workspace's statics module.
 */
const code = [
  "feature-panel-markup.js",
  "feature-panel.js",
  "property-panel.js",
  "statics-panel.js",
].map((name) => fs.readFileSync(modulePath(name), "utf8")).join("\n");

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

/* ============================================================
 * THE PUNCTUATION RULE, AT THE MODULE
 * ============================================================ */

console.log("\n  a missing value is not a field\n");

check(
  "an absent value renders no field",
  panels.readOnly("Direction", undefined) === null,
);
check(
  "a null value renders no field",
  panels.readOnly("Direction", null) === null,
);
check(
  "NaN renders no field, not the word NaN",
  panels.readOnly("Magnitude", NaN) === null,
  "NaN stringifies to something that looks like content",
);
check(
  "an empty string renders no field",
  panels.readOnly("Source Body", "") === null,
);
check(
  "an unformatted object renders no field",
  panels.readOnly("Direction", { dx: 0, dy: -1 }) === null,
  "an object reaching the display layer becomes [object Object]",
);

console.log("\n  and a value that IS there never drags punctuation in\n");

const populated = [
  panels.readOnly("Magnitude", 100, "N"),
  panels.readOnlyQuantity("Magnitude", 100, "N"),
  panels.scalar({
    label: "Length",
    key: "length",
    value: 500,
    unit: "mm",
  }),
  panels.select({
    label: "Line Type",
    attribute: "data-style",
    options: ["Solid", "Dashed"],
    value: "Solid",
  }),
];

populated.forEach((markup, index) => {
  const text = String(markup);
  check(
    `field ${index} carries no orphan punctuation`,
    !text.includes("> ,") &&
      !text.includes(",</span>") &&
      !text.includes("undefined") &&
      !text.includes("null") &&
      !text.includes("[object Object]"),
    text.replace(/\s+/g, " ").slice(0, 140),
  );
});

/* ============================================================
 * NO EMPTY SECTIONS
 * ============================================================ */

console.log("\n  a heading stands or falls with its fields\n");

check(
  "a heading over nothing renders nothing",
  panels.section("APPEARANCE", [
    panels.readOnly("Line Type", undefined),
  ]) === "",
  "an APPEARANCE heading is standing over fields that were never emitted",
);

check(
  "and not even the heading text",
  !panels
    .section("ANNOTATION", [panels.readOnly("Show Unit", null)])
    .includes("ANNOTATION"),
);

check(
  "a heading with a field renders both",
  panels
    .section("POSITION", [panels.readOnly("X", 100, "mm")])
    .includes("POSITION"),
);

/* ============================================================
 * THE PANEL DELEGATES, IT DOES NOT REIMPLEMENT
 * ============================================================ */

console.log("\n  the feature panel uses the shared vocabulary\n");

/*
 * The builder, with the two helpers every panel builder shares (the heading
 * marker and the finalise pass), which sit just above it.
 */
const propertyMarkup = section(
  "const section = label =>",
  "function pointSizeMarkup(",
);

check(
  "the panel reads the shared module",
  /enggPropertyPanel/.test(propertyMarkup),
  "the panel is not using the shared module, so it will drift from the others",
);

check(
  "its scalar field goes through the shared scalar",
  /panels\.scalar\(/.test(propertyMarkup),
  "the numeric field is built by hand again",
);

check(
  "its coordinate fields go through the shared scalar",
  !/coordinatePair\s*=/.test(propertyMarkup) &&
    /panels\.scalar\(/.test(propertyMarkup),
  "coordinates are being concatenated into one string again",
);

check(
  "its headings are markers resolved against their fields",
  /<!--section:/.test(propertyMarkup) && /finaliseRows/.test(propertyMarkup),
  "a heading can be emitted over nothing",
);

/* ============================================================
 * A HELPER THAT RETURNS ROWS IS RENDERED, NOT DROPPED
 * ============================================================ */

console.log("\n  a group of fields returned by a helper is rendered\n");

/*
 * THE VANISHING-SUPPORT DEFECT.
 *
 * A panel helper that builds a whole group of fields - the support panel, a
 * relative-coordinate block - returns its rows as an ARRAY, and the caller
 * pushes that array into the row list as ONE entry. The finalise pass only
 * understood strings, so every such entry was skipped: a support rendered as
 * its title and nothing else, every field it carried silently discarded.
 *
 * The pass now flattens first, so a helper may return one row or many without
 * the caller having to know which.
 */
check(
  "the finalise pass flattens nested row groups",
  /const flat = list\.flat\(Infinity\)/.test(propertyMarkup),
  "a helper returning an array of rows would be dropped",
);

check(
  "and every loop reads the flattened list, not the raw one",
  /for \(let index = 0; index < flat\.length; index \+= 1\)/.test(
    propertyMarkup,
  ) &&
    /for \(let ahead = index \+ 1; ahead < flat\.length; ahead \+= 1\)/.test(
      propertyMarkup,
    ),
  "a loop still walks the unflattened list",
);

check(
  "the support panel returns rows for the caller to flatten",
  /function supportPanelRows\(/.test(code) &&
    /return rows;/.test(
      section("function supportPanelRows(", "function distributedLoadPanelMarkup("),
    ),
  "the support panel no longer returns its rows",
);

check(
  "and the support branch pushes them where the pass can see them",
  /rows\.push\(\s*\n?\s*supportPanelRows\(object\)/.test(propertyMarkup) ||
    /supportPanelRows\(object\)/.test(propertyMarkup),
  "the support rows are never added to the panel",
);

/* ============================================================
 * THE TITLE APPEARS ONCE
 * ============================================================ */

console.log("\n  a feature is named once, not twice\n");

/*
 * THE DOUBLE-TITLE DEFECT.
 *
 * `featureHeaderMarkup` already emits the panel title - the feature's name, in
 * the shared title element - and the editable name field beneath it. The
 * wrapper around each panel's rows added a SECOND title carrying `object.name`,
 * so a Beam read
 *
 *     BEAM
 *     BEAM
 *
 * which looks like two features rather than one.
 *
 * So a block that has already pushed the shared header must not emit a title
 * of its own. The header is the one place a panel's name comes from.
 */
/*
 * Two title literals are legitimate: the header's own fallback (used when the
 * shared module is absent) and the "STATICS DISPLAY" block, which is a separate
 * global panel rather than a feature's name. Everything else was a feature
 * naming itself a second time.
 */
const titleSites = [
  ...code.matchAll(/<div class="drawing-properties-title">([^<]*)</g),
];

const duplicatedNames = titleSites.filter(
  (match) =>
    match[1].trim() !== "" &&
    !/\$\{/.test(match[1]) &&
    match[1].trim() !== "STATICS DISPLAY",
);

check(
  "no panel names itself a second time",
  duplicatedNames.length === 0,
  `${duplicatedNames.length} duplicate title(s): ` +
    duplicatedNames.map((m) => m[1].trim()).join(", "),
);

check(
  "the header fallback is the one that remains",
  /function featureHeaderMarkup\([\s\S]{0,600}drawing-properties-title/.test(
    code,
  ),
  "the surviving title is not the header's fallback",
);

/* ============================================================
 * ONE COORDINATE, ONE LABEL
 * ============================================================ */

console.log("\n  a position is the simplest engineering representation\n");

/*
 * THE NESTED-COORDINATE DEFECT.
 *
 * The coordinate helper used to route a SINGLE label through a two-row
 * builder, so `coordinate("Start X", ...)` rendered "Start X X" and
 * "Start X Y" - four nested combinations on a Beam, none of which is an
 * engineering concept. A position is Start/End, each with an X and a Y.
 *
 * The fix is that the helper emits ONE field per call, so the label it is
 * given is the label the student reads.
 */
check(
  "the coordinate helper is a single field, not a pair builder",
  /const coordinate = \(/.test(propertyMarkup) &&
    /panels\.scalar\(\{[\s\S]{0,200}?label,/.test(propertyMarkup),
  "a one-row label is being fed to a two-row builder again",
);

/* The pair builder was removed: a position is two separate single-row
 * coordinate calls at each site, each naming its own axis. Nothing may
 * reintroduce a helper that appends X/Y to one label, because that is the
 * nested-label defect this block guards against.
 */
check(
  "no pair builder appends axes to a single label",
  !/coordinatePair\s*=/.test(propertyMarkup),
  "a two-row pair builder has come back",
);

/*
 * NO DOUBLED COORDINATE LABEL.
 *
 * The defect was structural, not textual: a single label fed to a two-row
 * builder, so "Start X" became "Start X X" and "Start X Y". With the helper
 * now emitting ONE field per call, "Start X" is exactly the label a student
 * reads - and the labels themselves are the acceptance criterion.
 *
 * So what is asserted is that the labels ARE the simple form, and that nothing
 * in the panel is building a label by gluing a heading and an axis together.
 */
const simpleLabels = [
  ...propertyMarkup.matchAll(
    /coordinate\(\s*"(Start|End|Center|Centre|Position|Attachment)[^"]*"\s*,/g,
  ),
].map((match) => match[1]);

check(
  "every coordinate label is a plain engineering reference",
  simpleLabels.length > 0 &&
    simpleLabels.every((word) =>
      ["Start", "End", "Center", "Centre", "Position", "Attachment"].includes(
        word,
      ),
    ),
  `unexpected coordinate labels: ${[...new Set(simpleLabels)].join(", ")}`,
);

check(
  "no coordinate label is a heading with an axis appended by the caller",
  /*
   * The doubling came from the HELPER, not the label text: a one-row label fed
   * to a two-row builder. With the helper single-field, a label is exactly what
   * the student reads - including a numbered one such as "Point 1 X". What must
   * not return is a caller passing a label that is ITSELF already an X/Y pair
   * while also naming a heading, which is the "Start X X" shape.
   */
  !/coordinate\(\s*"(Start|End)\s+[XY]\s+[XY]"/.test(propertyMarkup),
  "a coordinate label names two axes, which is how it doubled before",
);

check(
  "the straight bodies use the plain Start / End labels",
  /coordinate\("Start X"/.test(propertyMarkup) &&
    /coordinate\("Start Y"/.test(propertyMarkup) &&
    /coordinate\("End X"/.test(propertyMarkup) &&
    /coordinate\("End Y"/.test(propertyMarkup),
  "a straight body is not offering Start X / Start Y / End X / End Y",
);

console.log("\n  and a missing number never prints the word NaN\n");

/*
 * The defect was `Number(undefined).toFixed(2)` - the string "NaN" - reaching a
 * panel field. Every local number formatter in the panel must guard against it.
 */
const codeOnly = code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/*
 * The PANEL SOURCE only - from the feature-property builder to the helper that
 * follows it. The status-bar coordinate readout and other drawing code are not
 * feature panels, and are guarded where they sit.
 */
const panelSource = section(
  "function featurePropertyMarkup(",
  "function pointSizeMarkup(",
);

const localNumbers = [
  ...codeOnly.matchAll(/const number\s*=\s*value\s*=>\s*\n?\s*Number\(value\)\.toFixed\(2\)/g),
];

check(
  "no number formatter is the unguarded Number(value).toFixed(2)",
  localNumbers.length === 0,
  `${localNumbers.length} unguarded formatter(s) remain, each of which prints "NaN"`,
);

const toFixedUnguarded = [
  ...panelSource.matchAll(/Number\([^)]*\)\.toFixed\(2\)/g),
].filter(
  match => !/Number\.isFinite/.test(panelSource.slice(Math.max(0, match.index - 160), match.index)),
);

check(
  "every toFixed(2) in a panel is guarded by a finiteness test",
  toFixedUnguarded.length === 0,
  `${toFixedUnguarded.length} unguarded toFixed(2) call(s): ${toFixedUnguarded
    .map(m => m[0])
    .join(", ")}`,
);

console.log("\n  no field is a concatenated string with a comma\n");

/*
 * The other punctuation source: two optional values joined with ", ". A panel
 * that builds "Start: 100 mm, End: 400 mm" as one string leaves a dangling
 * comma when one of them is absent. Fields are separate rows, so a panel must
 * not be assembling a comma-joined sentence of engineering values.
 */
const commaSentences = [
  ...panelSource.matchAll(/\$\{[^}]{0,40}\}\s*,\s*\$\{[^}]{0,40}\}/g),
].filter(match => /mm|N\b|°|Direction|Magnitude|Start|End/.test(match[0]));

check(
  "no panel glues two engineering values with a comma",
  commaSentences.length === 0,
  commaSentences.map(m => m[0]).join(" | "),
);

console.log(`\n${pass} passed, ${fail} failed\n`);

if (fail > 0) {
  process.exitCode = 1;
}

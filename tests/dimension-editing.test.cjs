/*
 * ========================================================
 * DIMENSIONS: EDITING, THE DRIVING VALUE, AND THE PREVIEW
 * ========================================================
 *
 * Four requirements, all about the same idea - a dimension is a LIVE reading of
 * geometry, and the box a student edits it in is the application's one value
 * box:
 *
 *   1. Double-clicking a dimension opens the STANDARD value popup and never
 *      the World Scale question.
 *   2. A Variable Dimension starts EMPTY and never shows the measured value.
 *   3. Its preview shows the dimension geometry, with no answer in it.
 *   4. A measured dimension stays DRIVING: its value is re-read from the
 *      geometry every frame, never frozen by the first entry.
 */

const fs = require("fs");

const { modulePath } = require("./helpers/source-path.cjs");

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

const events = fs.readFileSync(modulePath("canvas-events.js"), "utf8");
const tool = fs.readFileSync(modulePath("dimension-tool.js"), "utf8");
const renderer = fs.readFileSync(modulePath("renderer.js"), "utf8");
const model = fs.readFileSync(modulePath("dimension-model.js"), "utf8");

console.log("\n  a double-click opens the STANDARD value popup\n");

check(
  "the dimension's double-click opens the shared prompt",
  /openDimensionValuePrompt\(pointed\)/.test(events),
);

check(
  "and NEVER the dimension editor that asks for World Scale",
  !/openDimensionEditorFor\(pointed\)/.test(events),
  "the scale is a property of the sheet, not of one dimension",
);

check(
  "the prompt is the application's ONE value popup",
  /openDimensionValuePrompt[\s\S]{0,4000}openLoadValuePopup\(\{/.test(tool),
  "a dimension-specific dialog would be a second thing to learn",
);

check(
  "a variable dimension edits the same way",
  /pointed\?\.type === "variable-dimension"[\s\S]{0,200}openDimensionValuePrompt/.test(
    events,
  ),
);

console.log("\n  a VARIABLE dimension starts EMPTY\n");

check(
  "the creation prompt opens on an empty field",
  /title: "Variable Dimension"[\s\S]{0,120}value: ""/.test(tool),
  "the measured value must never be offered as a starting answer",
);

check(
  "and nothing is created until the student answers",
  (() => {
    const at = tool.indexOf("function openVariablePrompt(");
    const body = tool.slice(at, at + 4000);

    /* The factory call lives inside onConfirm, after the popup is opened. */
    return (
      body.indexOf("openLoadValuePopup({") <
      body.indexOf('"variable-dimension"')
    );
  })(),
);

console.log("\n  and its PREVIEW shows no measured value\n");

check(
  "the armed preview is built as a variable when that is the tool",
  /previewingVariable[\s\S]{0,400}type: previewingVariable \? "variable-dimension" : "dimension"/.test(
    renderer,
  ),
  "a dimension probe made the preview draw the measured number",
);

check(
  "with an EMPTY symbol, which draws the shape and no text",
  /symbol: previewingVariable \? "" : undefined/.test(renderer),
);

check(
  "and the preview is drawn by that kind's OWN renderer",
  /if \(previewingVariable\) \{\s*\n\s*appendVariableDimensionEntity\(/.test(
    renderer,
  ),
);

check(
  "the variable renderer draws nothing for an empty symbol",
  /const symbol = enggVariableDimension\.variableText\(entity\);[\s\S]{0,220}if \(!symbol\.trim\(\)\) \{\s*\n\s*return;/.test(
    renderer,
  ),
);

console.log("\n  a MEASURED dimension stays DRIVING\n");

check(
  "no measured dimension stores a magnitude on the feature",
  !/object\.geometry\.magnitude\s*=/.test(model) &&
    !/\.dimensionValue\s*=/.test(model),
  "a stored copy is a second answer, free to go stale",
);

check(
  "editing a dimension applies the value to the GEOMETRY, not the feature",
  /applyDimensionValue\(\s*\n\s*object,\s*\n\s*drawingState,/.test(tool),
  "the dimension then measures the geometry exactly as before",
);

check(
  "and the edit does not write the feature's references",
  (() => {
    const at = tool.indexOf("export function openDimensionValuePrompt");
    const body = tool.slice(at, at + 5000);

    /* `sourceRefs` must not be assigned anywhere in the edit path. */
    return !/object\.sourceRefs\s*=/.test(body);
  })(),
  "a value edit changes what it says, never what it is attached to",
);

check(
  "the panel and the sheet read the same live measurement",
  /measurementFor/.test(model),
  "both must be recomputed from the geometry, never cached",
);

console.log("\n  a symbolic entry on a dimension is its LABEL\n");

check(
  "a symbol is written to the label, not to a number field",
  /object\.magnitudeLabel = answer\.text/.test(tool),
);

console.log(`\n  ${pass} passed, ${fail} failed\n`);

if (fail) {
  process.exitCode = 1;
}

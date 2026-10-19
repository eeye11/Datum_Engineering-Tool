/*
 * ========================================================
 * DIMENSIONS: EDITING, VALUE PROMPTS, AND ANNOTATION LABELS
 * ========================================================
 *
 * DAETUM geometry is schematic: a dimension may display a value supplied by
 * the problem, and that display value must be an ANNOTATION that does not:
 *   - resize geometry
 *   - calibrate drawing scale
 *
 * This file pins the UI wiring and the storage rules that support that.
 */

const fs = require("fs");

const { modulePath, rendererSource } = require("./helpers/source-path.cjs");

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
const renderer = rendererSource();
const model = fs.readFileSync(modulePath("dimension-model.js"), "utf8");

console.log("\n  a double-click opens the STANDARD value popup\n");

check(
  "the dimension's double-click opens the shared prompt",
  /openDimensionValuePrompt\(pointed\)/.test(events),
);

check(
  "and NEVER the dimension editor that asked for World Scale",
  !/openDimensionEditorFor\(pointed\)/.test(events),
  "a drawing scale must never be asked as a side-effect of editing a label",
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
    return body.indexOf("openLoadValuePopup({") < body.indexOf('"variable-dimension"');
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

console.log("\n  editing a MEASURED dimension writes an ANNOTATION label\n");

check(
  "dimension editing does not drive geometry",
  (() => {
    const at = tool.indexOf("export function openDimensionValuePrompt");
    const body = tool.slice(at, at + 4500);

    return !/applyDimensionValue\(/.test(body);
  })(),
  "a schematic dimension label must not resize geometry",
);

check(
  "dimension editing does not calibrate or set world scale",
  (() => {
    const at = tool.indexOf("export function openDimensionValuePrompt");
    const body = tool.slice(at, at + 4500);

    return !/isCalibrated/.test(body) && !/\.calibrate\(/.test(body);
  })(),
);

check(
  "a numeric entry is stored as the dimension's label override",
  /answer\.kind === "number"[\s\S]{0,1200}object\.label =/.test(tool),
);

check(
  "a symbolic entry is stored as the dimension's label override",
  /answer\.kind === "symbol"[\s\S]{0,120}object\.label = answer\.text/.test(tool),
);

check(
  "the renderer/model honours the label override",
  /typeof dimension\?\.label === "string"[\s\S]{0,200}return override;/.test(model),
  "formatMeasurement should return the override when present",
);

console.log(`\n  ${pass} passed, ${fail} failed\n`);

if (fail) {
  process.exitCode = 1;
}
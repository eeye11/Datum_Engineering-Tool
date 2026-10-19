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
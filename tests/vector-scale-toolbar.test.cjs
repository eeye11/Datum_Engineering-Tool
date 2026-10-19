/*
 * ========================================================
 * VECTOR SCALE LIVES ON THE TOP TOOLBAR
 * ========================================================
 *
 * It is a SHEET-WIDE display setting - one number deciding how large every
 * force and load arrow is DRAWN - so it belongs on the top toolbar beside
 * Magnitudes, not inside a feature's own properties. This pins:
 *
 *   the control is on the toolbar      an input, beside Magnitudes
 *   it is NOT in the Features panel    no statics-display block, no binding
 *   it writes the shared setting       state.statics.vectorScale
 *   it never touches the physics       magnitudes, units, directions untouched
 *   it takes no undo step              a display change is not a drawing change
 */

const fs = require("fs");
const path = require("path");

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

const html = fs.readFileSync(
  path.join(__dirname, "..", "index.html"),
  "utf8",
);

const dom = fs.readFileSync(locate("dom.js"), "utf8");
const controls = fs.readFileSync(locate("workspace-controls.js"), "utf8");
const panel = fs.readFileSync(locate("feature-panel.js"), "utf8");
const staticsPanel = fs.readFileSync(locate("statics-panel.js"), "utf8");

console.log("\n  the control is on the TOP TOOLBAR\n");

check(
  "there is a Vector Scale input in the toolbar markup",
  /id="drawingVectorScale"/.test(html) &&
    /drawingVectorScale[^>]*type="number"/.test(html),
  "it must be directly editable",
);

check(
  "and it sits beside Magnitudes",
  html.indexOf("drawingMagnitudesToggle") <
    html.indexOf("drawingVectorScale"),
  "both are display controls for the same arrows",
);

check(
  "with no OTHER control between them",
  !/drawingMagnitudesToggle[\s\S]*?id="(drawing\w*Toggle|drawingThickness|drawingColor|drawingLineType)"[\s\S]*?id="drawingVectorScale"/.test(
    html,
  ),
  "a control placed after Magnitudes belongs next to it",
);

check(
  "it is found once, by the shared DOM layer",
  /drawingVectorScale = document\.getElementById\("drawingVectorScale"\)/.test(
    dom,
  ),
);

console.log("\n  it is a GLOBAL setting that writes the shared value\n");

check(
  "the toolbar writes state.statics.vectorScale",
  /vectorScale:\s*numeric/.test(controls),
);

check(
  "and redraws the canvas",
  /vectorScale:\s*numeric[\s\S]{0,400}?renderCurrentDrawing\(\)/.test(controls),
);

check(
  "it takes NO undo snapshot",
  !/snapshotDrawing[\s\S]{0,400}?vectorScale/.test(controls),
  "a display change is not a change to the drawing, so Ctrl+Z must skip it",
);

check(
  "and an out-of-range entry is refused rather than stored",
  /numeric\s*<\s*enggLoadProfile\.MIN_VECTOR_SCALE[\s\S]{0,120}?numeric\s*>\s*enggLoadProfile\.MAX_VECTOR_SCALE/.test(
    controls,
  ),
  "a scale of zero would draw every arrow as a dot",
);

console.log("\n  and it is the SAME DROPDOWN the panel used, with Custom at the end\n");

check(
  "the options come from the shared table, not a new list",
  /enggLoadProfile\.VECTOR_SCALE_OPTIONS/.test(controls),
  "a second list of scales is a second answer to which scales exist",
);

check(
  "and CUSTOM is offered after them",
  /enggLoadProfile\.CUSTOM_VECTOR_SCALE[\s\S]{0,120}?Custom/.test(controls),
);

check(
  "a value the list does not carry reveals the custom field",
  /CUSTOM_VECTOR_SCALE[\s\S]{0,400}?hidden = false/.test(controls),
);

check(
  "and the control is put back in step with the model",
  /vectorScaleFor\(drawingState\)/.test(controls),
);

console.log("\n  it is GONE from the Features panel\n");

check(
  "the panel no longer renders a statics-display block",
  !/staticsDisplayMarkup/.test(panel),
);

check(
  "and the block itself is removed from the statics panel",
  !/drawing-statics-display/.test(staticsPanel),
);

check(
  "so the Features tab is the selection's own properties alone",
  /host\.innerHTML = featuresMarkupForSelection\(objects\)/.test(
    fs.readFileSync(locate("features-editor.js"), "utf8"),
  ),
);

check(
  "and no statics-display control is offered anywhere in the panel",
  !/data-statics-vector-scale/.test(staticsPanel) &&
    !/data-statics-vector-custom/.test(staticsPanel) &&
    !/data-statics-vector-scale/.test(
      fs.readFileSync(locate("feature-schema.js"), "utf8"),
    ),
  "the vector scale is a toolbar display setting, not a feature property",
);

console.log("\n  the physics is untouched by the scale\n");

check(
  "the setting is display-only, read by the arrows",
  /function vectorScaleFor/.test(
    fs.readFileSync(locate("load-profile.js"), "utf8"),
  ),
);

console.log(`\n  ${pass} passed, ${fail} failed\n`);

if (fail) {
  process.exitCode = 1;
}

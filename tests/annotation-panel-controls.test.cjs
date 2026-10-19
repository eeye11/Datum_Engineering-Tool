/*
 * ========================================================
 * ARE THE ANNOTATION CONTROLS CONNECTED TO ANYTHING?
 * ========================================================
 *
 * A switch that is not wired is worse than no switch. It looks like a control,
 * it sits under a heading that promises something, and clicking it does
 * nothing - so the student concludes the feature cannot show its magnitude,
 * which is a false conclusion about an engineering object.
 *
 * That is the specific risk here: the annotation model has supported
 * per-feature magnitude boxes all along, the panel now offers the switches,
 * and the only thing standing between them is that both halves actually read
 * the same field and write it back through the same channel.
 *
 * Three things have to line up, and each is checked below:
 *
 *   1. THE SECTION IS OFFERED ONLY WHERE IT MEANS SOMETHING. A beam has no
 *      magnitude to annotate, so it gets no ANNOTATION heading. Rendering one
 *      over nothing is the empty-section defect in a new place.
 *   2. THE CHECKBOX REFLECTS WHAT THE RENDERER WILL DO. Read through the
 *      model's predicate, not by inspecting the display state directly, or the
 *      panel and the sheet disagree whenever they are asked different
 *      questions.
 *   3. THE CLICK IS WRITTEN BACK AS A BOOLEAN AND AS ONE HISTORY ACTION. A
 *      string "false" written back reads as truthy next time and leaves the
 *      switch permanently on.
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

const code = fs
  .readFileSync(modulePath("statics-panel.js"), "utf8")
  .replace(/\r\n/g, "\n");

/*
 * The feature-panel markup moved to its own module in the Phase 2
 * reorganisation, so the panel slices below are read from there.
 *
 * `property-binding.js` IS NOT READ ANY MORE. It existed only to connect the
 * old Features panel's controls to the feature, and it was deleted with that
 * panel - so listing it here would be naming a file that no longer exists.
 */
const panelMarkup = [
  fs.readFileSync(modulePath("feature-panel-markup.js"), "utf8"),
  fs.readFileSync(modulePath("statics-panel.js"), "utf8"),
].join("\n").replace(/\r\n/g, "\n");

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

const section = (startMarker, endMarker) => {
  const start = code.indexOf(startMarker);

  if (start < 0) {
    return "";
  }

  const end = code.indexOf(endMarker, start + startMarker.length);

  return code.slice(start, end < 0 ? undefined : end);
};

console.log("\n  THE SECTION IS BUILT FROM THE SHARED MODULE\n");

const builder = section(
  "function annotationSectionMarkup(",
  "const MAGNITUDE_BEARING_TYPES",
);

check(
  "the annotation section exists",
  builder.length > 0,
);

check(
  "and is composed from the shared toggle, not hand-written",
  /panels\.toggle\(\{/.test(builder),
  "a hand-written checkbox will drift from every other switch in Datum",
);

check(
  "it is a section, so it can be omitted when empty",
  /panels\.section\(\s*"ANNOTATION"/.test(builder),
);

check(
  "and it renders nothing at all without the shared module",
  /if\s*\(\s*!panels\s*\)/.test(builder),
  "a fallback copy of these controls would drift from this one",
);

console.log("\n  AND ONLY FOR FEATURES THAT HAVE A MAGNITUDE\n");

check(
  "membership is asked of a list, not guessed per panel",
  /types\.has\(object\.type\)/.test(builder),
  "'does this feature have a magnitude' has to be answered once, consistently",
);

check(
  "a feature outside the list renders no section",
  builder.includes("return \"\";") &&
    !/if\s*\([\s\S]{0,200}types[\s\S]{0,200}\}\)\s*\{\s*rows\.push/.test(
      builder,
    ),
);

/*
 * The list is NOT written in the panel code. It is read from the annotation
 * model's own kind table, because that table is already the authority on which
 * feature types carry something worth annotating.
 *
 * That is not tidiness. The first version of this named "distributed-load"
 * and "applied-moment" while Datum's features are called "load" and
 * "moment" - so the section was offered to no feature at all, while looking
 * entirely plausible.
 */
const typeList = section(
  "const MAGNITUDE_BEARING_TYPES",
  "The Arc Radius row",
);

check(
  "the type list is read from the annotation model, not written here",
  /enggAnnotationModel/.test(typeList) &&
    /annotatableTypes\(\)/.test(typeList),
  "a second list of feature types is a second answer to a question the model already answers",
);

check(
  "and an absent model offers the section to nothing rather than guessing",
  /return new Set\(\);/.test(typeList),
  "with no model to ask, a guessed list would offer switches for features that cannot have one",
);

/*
 * And the set it produces has to be the real one. Read from the model rather
 * than from the panel source, because the panel's correctness depends on
 * this being right, not on it having been written down again.
 */
loadModule("annotation-model.js");

const annotatable = global.window.enggAnnotationModel
  .annotatableTypes();

[
  "force",
  "load",
  "varying-load",
  "moment",
  "resultant",
  "force-components",
  "pin-support",
  "roller-support",
  "fixed-support",
  "smooth-support",
].forEach(type => {
  check(
    `${type} is a feature that can carry an annotation`,
    annotatable.has(type),
    `${type} carries a value but is not in the model's kind table`,
  );
});

[
  "beam",
  "circle",
  "line",
  "analysis-diagram",
].forEach(type => {
  check(
    `${type} has nothing to annotate`,
    !annotatable.has(type),
    `${type} would be given a Show Magnitude switch that does nothing`,
  );
});

console.log("\n  THE CHECKBOX ASKS THE MODEL, NOT THE DISPLAY STATE\n");

check(
  "the shown state is read through the model's predicate",
  /magnitudeShownFor\(object,\s*state\)/.test(builder),
  "reading display.showMagnitudes directly would ignore the per-feature setting",
);

check(
  "and is not read straight off the feature's own field",
  !/on:\s*display\.showMagnitude\b/.test(builder),
  "the panel is reading the preference rather than asking whether a box shows",
);

console.log("\n  AND IT IS OFFERED WHERE IT APPLIES\n");

/*
 * Located from the start of the force branch rather than by relative position
 * within it: the Point Force block ends where the moment branch begins.
 *
 * THE POINT FORCE NO LONGER CARRIES THE ANNOTATION SECTION. Its Label is a
 * feature property now, emitted immediately under Feature Name, and the
 * drawing-space magnitude annotation still renders per the application's
 * existing load-display behaviour - it just has no ANNOTATION section in the
 * Feature Panel. The Resultant keeps the section, so the section itself is
 * still asserted below, against the panel that has it.
 */
const forcePanel = panelMarkup.slice(
  panelMarkup.indexOf('} else if (object.type === "force")'),
  panelMarkup.indexOf('} else if (object.type === "moment")'),
);

check(
  "the Point Force panel carries no ANNOTATION section",
  !/annotationSectionMarkup\(\s*object,\s*MAGNITUDE_BEARING_TYPES\s*\)/.test(
    forcePanel,
  ),
  "Label is a feature property, not an annotation-panel property",
);

check(
  "and its Label sits before the FORCE section",
  (() => {
    const labelAt = forcePanel.indexOf("standalone: true");

    const forceAt = forcePanel.indexOf('section("FORCE")');

    return (
      labelAt >= 0 &&
      forceAt > labelAt
    );
  })(),
  "Label must be the first property area after Feature Name",
);

check(
  "the Resultant panel still shows the section",
  /annotationSectionMarkup\(\s*object,\s*MAGNITUDE_BEARING_TYPES\s*\)/.test(
    panelMarkup,
  ),
  "the section survives where a feature still offers it",
);

console.log("\n  AND A CLICK IS WRITTEN BACK PROPERLY\n");

/*
 * THE PANEL'S OWN CONTROL WIRING IS GONE.
 *
 * The magnitude switch used to be bound in `property-binding.js`, which existed
 * only to connect the old Features panel's controls to the feature. That panel
 * was replaced by the inspector's Features tab, so the module and its handlers
 * went with it - and a test that kept reading them would be asserting on a
 * deleted file.
 *
 * WHAT STILL MATTERS IS THE STORAGE. The switch's whole point was that the
 * preference lands on the feature, as a real boolean, without discarding the
 * settings beside it - and that is a property of the MODEL, which this file
 * already has in hand. So the shape is checked against a feature rather than
 * against the handler that used to write it.
 */
const feature = (() => {
  const model = require(locate("drawing-state.js")).default;

  return model.geometryFactories.force({ x: 0, y: 0 }, { x: 10, y: 10 }, {});
})();

feature.annotationDisplay = { ...(feature.annotationDisplay || {}), showMagnitude: false };

check(
  "a feature can hold its own display preference",
  typeof feature.annotationDisplay.showMagnitude === "boolean",
  "the preference is not stored where magnitudeShownFor reads it",
);

check(
  "and storing it preserves any sibling settings",
  Object.keys(feature.annotationDisplay).includes("showMagnitude"),
  "writing one setting is discarding the others on that holder",
);

check(
  "a stored false is a boolean, not the checkbox's string",
  feature.annotationDisplay.showMagnitude === false,
  'a stored "false" reads as truthy next time and leaves the switch stuck on',
);

/*
 * THE SWITCH ITSELF IS NOT OFFERED. It was removed deliberately: a magnitude
 * without its unit is not the same quantity as one with it, so there is no
 * choice to make.
 */
console.log("\n  AND UNITS ARE NOT A CHOICE\n");

/*
 * THERE IS NO UNIT SWITCH ANY MORE.
 *
 * It used to be offered per feature, on the reasoning that the
 * annotation model might hide units. It never could - `unitSuffix`
 * takes the flag and ignores it - so the switch was a control that
 * changed nothing, which is worse than no control at all: it implied
 * a choice that did not exist.
 *
 * A magnitude without its unit is not the same quantity as one with
 * it. "100" and "100 N" are different statements, and on a diagram
 * where a force, a load intensity and a moment all sit side by side,
 * a reader who saw bare numbers would have no way to tell them apart.
 */
check(
  "no unit switch is rendered on any feature panel",
  !code.includes('label: "Show Unit"') &&
    !code.includes("data-feature-show-unit"),
  "a Show Unit toggle is still being built",
);

check(
  "and none is left wired up to do something",
  !/data-feature-show-unit[\s\S]{0,400}addEventListener/.test(code),
  "a dead handler for a removed control is still in the source",
);

console.log("\n  the shared module can actually build what is asked of it\n");

check(
  "one toggle and a heading render",
  panels
    .section("ANNOTATION", [
      panels.toggle({
        label: "Show Magnitude",
        attribute: "data-feature-show-magnitude",
        on: true,
      }),
    ])
    .includes("ANNOTATION"),
);

console.log(
  `\n${pass} passed, ${fail} failed`,
);

if (fail > 0) {
  process.exitCode = 1;
}

/*
 * ========================================================
 * A FEATURE'S LABEL IS ITS OWN PROPERTY
 * ========================================================
 *
 * The Features panel's Label field accepted text and did nothing: the input had
 * NO HANDLER anywhere, and it was bound to the feature's NAME rather than to a
 * label. Line and Point were both affected, because the field is shared.
 *
 * These check the whole path a label takes - the setter, the model, and the
 * three things the field must NOT disturb - so a regression in any of them is
 * caught here rather than by a student noticing that their label never appeared.
 */

const { JSDOM } = require("jsdom");
const { locate, rendererSource } = require("./helpers/source-path.cjs");

/*
 * THE EDITOR'S MODULES REACH THE DOM AT LOAD TIME.
 *
 * The model modules reach the editor state, which imports `dom.js`, which
 * looks its elements up as it loads. So the document has to exist BEFORE the
 * modules are required - the same bootstrap every editor-side test uses.
 */
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    pretendToBeVisual: true,
});

global.window = dom.window;
global.document = dom.window.document;
global.navigator = dom.window.navigator;
global.Element = dom.window.Element;

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

/*
 * THE FEATURES PANE WRITES A LABEL THROUGH ITS FIELD TABLE - the `label`
 * field's own `write` - so that is what is exercised here. (The old panel's
 * shared `updateFeatureProperty` setter is retired with that panel.)
 */
const schema = require(locate("feature-schema.js"));

/*
 * THE LABEL ROW, NOT THE NAME ROW.
 *
 * `name` and `label` are deliberately separate properties - the inventory calls
 * a feature one thing and the sheet prints another - so the drawn text is
 * written by the Label field. Using the Name field here would test the wrong
 * row and assert the wrong promise.
 */
const setLabel = (feature, value) => schema.fieldDefinition("label").write(feature, value);
const drawingState = require(locate("drawing-state.js")).default;

const line = () =>
    drawingState.geometryFactories.line({ x: 0, y: 0 }, { x: 40, y: 0 });

const point = () => drawingState.geometryFactories.point({ x: 10, y: 20 });

console.log("\n  the setter writes a LABEL, not a name\n");

{
    const feature = line();
    const nameBefore = feature.name;

    const changed = setLabel(feature, "AB");

    check("setting a label reports a change", changed === true);
    check("and stores it on the feature", feature.label === "AB", feature.label);
    check(
        "and the NAME is left alone - the two are different properties",
        feature.name === nameBefore,
        `${nameBefore} -> ${feature.name}`,
    );
    check(
        "and the label is not smuggled into the geometry",
        feature.geometry.label === undefined,
    );
}

console.log("\n  clearing it removes the text, not the feature\n");

{
    const feature = line();
    setLabel(feature, "AB");

    const cleared = setLabel(feature, "");

    check("clearing reports a change", cleared === true);
    check("and stores an empty label", feature.label === "", JSON.stringify(feature.label));
    check(
        "an empty label is distinguishable from never-set",
        "label" in feature && feature.label === "",
    );
    check("the feature is still a real line", feature.type === "line" && !!feature.geometry.end);
}

console.log("\n  it works the same way for a Point\n");

{
    const feature = point();

    setLabel(feature, "P1");

    check("a point carries a label", feature.label === "P1");
    check(
        "and its position is untouched",
        feature.geometry.position.x === 10 && feature.geometry.position.y === 20,
        JSON.stringify(feature.geometry.position),
    );
}

console.log("\n  a label never moves the geometry it belongs to\n");

{
    const feature = line();
    const before = JSON.stringify(feature.geometry);

    setLabel(feature, "A very long label, indeed");

    check("setting a label leaves the geometry identical", JSON.stringify(feature.geometry) === before);
}

console.log("\n  A LOCK DOES NOT BLOCK A LABEL\n");

{
    /*
     * Locking is a constraint on GEOMETRY. A student fixes a point in place
     * precisely so they can annotate it without moving it, so the label must
     * still apply - and, just as importantly, must not be able to UNLOCK or
     * move anything either.
     */
    const feature = point();
    const before = JSON.stringify(feature.geometry);

    feature.constraints = { position: "fixed" };

    const changed = setLabel(feature, "Fixed node");

    check("a locked feature still takes a label", changed === true && feature.label === "Fixed node");
    check("and the constraint is untouched", feature.constraints.position === "fixed");
    check("and the locked position did not move", JSON.stringify(feature.geometry) === before);
}

console.log("\n  the label travels with the feature through a save\n");

{
    const feature = line();
    setLabel(feature, "Round Trip");

    /* The same serialization the document file uses. */
    const json = drawingState.serializeDrawing({
        version: 1,
        units: "mm",
        objects: [feature],
        camera: { zoom: 1, panX: 0, panY: 0 },
        selection: { selectedObjectIds: [] },
        interaction: {}
    });

    const restored = JSON.parse(json).objects[0];

    check(
        "the label survives a save and load",
        restored.label === "Round Trip",
        JSON.stringify(restored.label),
    );
    check(
        "and so does the feature's own name, separately",
        restored.name === feature.name,
    );
}

console.log("\n  the panel field is wired to the model\n");

{
    const fs = require("fs");
    const schemaSource = fs.readFileSync(locate("feature-schema.js"), "utf8");

    check(
        "the Name field shows the NAME",
        schema.readField({ type: "line", name: "Line 4", label: "AB", geometry: {} }, "name") === "Line 4",
        "the single naming field reads object.name",
    );

    /*
     * NAME AND LABEL ARE TWO PROPERTIES, EDITED IN TWO ROWS.
     *
     * `name` is what the inventory and the source header call a feature;
     * `label` is the text drawn beside it. A student may call a load "Boom 2"
     * and label it "w = 5 kN/m", so renaming must not rewrite the drawing and
     * labelling must not rename the object. Both rows are declared, and the
     * Name row writes only `object.name`.
     */
    check(
        "there is a Name field in the schema",
        /name:\s*nameField/.test(schemaSource),
        "the pane has no Name field to render",
    );

    check(
        "which writes the feature's name and NOT its drawn label",
        /const nameField = \{[\s\S]{0,1600}?object\.name = String\(value \?\? ""\)\.trim\(\)/.test(schemaSource) &&
            !/const nameField = \{[\s\S]{0,1600}?object\.label = name/.test(schemaSource),
        "a rename would rewrite the drawing",
    );

    check(
        "and the Label row is its own field",
        /const labelField = \{/.test(schemaSource) && /label:\s*labelField/.test(schemaSource),
        "there is no separate Label control for the drawn text",
    );
}

console.log("\n  the renderer draws it, and only when there is one\n");

{
    const fs = require("fs");
    const renderer = rendererSource();

    check(
        "the renderer reads the feature's label",
        /entity\?\.label|entity\.label/.test(renderer),
    );

    check(
        "an empty label draws nothing",
        /text\s*=\s*typeof entity\?\.label === "string" \? entity\.label\.trim\(\) : ""[\s\S]{0,120}?if \(!text\)/.test(
            renderer,
        ),
        "a blank label must not leave a stray mark",
    );

    check(
        "and a label cannot swallow the pointer",
        /pointer-events": "none"/.test(renderer),
        "a label over its own feature would block selection and snapping",
    );

    check(
        "it is drawn for EVERY feature, in one pass",
        /(?:state\.objects|drawn)\.forEach\(\(entity\) => \{[\s\S]{0,200}?appendFeatureLabel/.test(renderer),
        "a per-type branch is exactly what was missing for Line and Point",
    );
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);

if (fail) {
    process.exitCode = 1;
}

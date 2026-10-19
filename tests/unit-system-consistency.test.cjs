/*
 * Regression tests for the shared unit-entry system.
 *
 * The property the specification calls out: entering 5 with metres selected
 * must mean 5 metres in EVERY length-bearing field, not 5 millimetres; a
 * bare number is read in the field's own unit; an explicit suffix overrides
 * it; and a statics magnitude is read in ITS quantity's unit, never a
 * length's.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
/* Source modules are found by file name, so they can move between folders. */
const { locate } = require("./helpers/source-path.cjs");
const read = p => fs.readFileSync(p.startsWith("src/") ? locate(path.basename(p)) : path.join(root, p), "utf8");

const quantities = require(path.join(root, "src/shared/units/quantities.js")).default;

/*
 * THE UNIT RESOLUTION IS SHARED. The setter resolves the display unit
 * through one helper, so no length branch can resolve it differently - the
 * metre/millimetre split came from exactly that.
 */
test("property-update resolves the display unit once, through one helper", () => {
    const update = read("src/editor/property-update.js");

    assert.match(
        update,
        /function displayLengthUnitOf\(object\)/,
        "one helper resolves the display unit"
    );

    assert.match(
        update,
        /function worldLengthInDisplayUnits\(object, value\)/,
        "one helper converts a typed length in that unit"
    );

    /*
     * NO BRANCH RESOLVES THE UNIT ITSELF. A hardcoded 'mm' conversion in a
     * length setter is the metre bug in miniature, so the setter must not
     * contain one anywhere.
     */
    assert.doesNotMatch(
        update,
        /fromEngineering\(\s*drawingState,\s*value,\s*'mm'\s*\)/,
        "a length branch hardcodes millimetres again"
    );
});

/*
 * THE ROUND TRIP, THROUGH THE REAL FUNCTIONS: 5 m in, 5 m out, on a
 * calibrated sheet as well as an uncalibrated one.
 */
test("5 metres round-trips through a calibrated sheet for every length unit", () => {
    const dimensions = require(path.join(root, "src/shared/scale/dimensions.js")).default;

    for (const unit of ["mm", "cm", "m", "in", "ft"]) {
        for (const scale of [
            null,
            { mmPerUnit: 1, unit: "mm" },
            { mmPerUnit: 4, unit: "mm" },
        ]) {
            const state = { scale };

            const world = dimensions.fromEngineering(state, 5, unit);

            const mm = dimensions.toEngineering(state, world);
            const shown = quantities.convertValue(mm.value, "length", "mm", unit);

            assert.ok(
                Math.abs(shown - 5) < 1e-9,
                `5 ${unit} must read back as 5 (scale ${scale?.mmPerUnit ?? "default"}), got ${shown}`
            );
        }
    }
});

/*
 * THE STATIC QUANTITIES ARE DIFFERENT DIMENSIONS. The binding layer must
 * resolve a magnitude's unit from the feature's own unit key, and the
 * entries below pin each family to its own list.
 */
test("each statics quantity has its own unit list, disjoint from the others", () => {
    const force = quantities.unitsFor("force");
    const moment = quantities.unitsFor("moment");
    const load = quantities.unitsFor("distributedLoad");

    assert.ok(force.includes("N") && force.includes("kN"));
    assert.ok(moment.includes("N·m") && moment.includes("kN·m"));
    assert.ok(load.includes("kN/m") && load.includes("N/mm"));

    /* A force unit in a moment field is refused, and the reverse. */
    assert.equal(quantities.isUnitFor("moment", "kN"), false);
    assert.equal(quantities.isUnitFor("force", "kN/m"), false);
    assert.equal(quantities.isUnitFor("length", "kN"), false);
});

test("a bare number is read in the field's own statics unit, and a suffix overrides it", () => {
    /* A force field reading kN: a bare 5 is 5 kN. */
    assert.deepEqual(quantities.readQuantity("5", "force", "kN"), {
        value: 5,
        unit: "kN",
        explicit: false,
    });

    /* A suffix wins: 5 N is 5 N whatever the selector says. */
    assert.deepEqual(quantities.readQuantity("5 N", "force", "kN"), {
        value: 5,
        unit: "N",
        explicit: true,
    });

    /* A moment field reads its own family, including the middle dot. */
    assert.deepEqual(quantities.readQuantity("2.5 kN·m", "moment", "N·m"), {
        value: 2.5,
        unit: "kN·m",
        explicit: true,
    });

    /* A load field reads an intensity unit, including the slash. */
    assert.deepEqual(quantities.readQuantity("5 N/mm", "distributedLoad", "kN/m"), {
        value: 5,
        unit: "N/mm",
        explicit: true,
    });

    /* A cross-family suffix is refused, not half-read. */
    assert.equal(quantities.readQuantity("5 mm", "force", "N"), null);
    assert.equal(quantities.readQuantity("5 kN", "length", "m"), null);
});

/*
 * THE PANEL: ONE SELECTOR PER LENGTH ROW, NO DUPLICATE STATIC LABEL. The
 * helpers suppress the static unit whenever a selector is rendered, so the
 * row cannot show "5 m [m v]".
 */
test("length rows render exactly one unit statement", () => {
    const markup = read("src/editor/feature-panel-markup.js");

    const scalarBody = markup.slice(
        markup.indexOf("const scalar = ("),
        markup.indexOf("const coordinate = (")
    );

    /* The selector suppresses the static label, and the selector is handed over. */
    assert.match(
        scalarBody,
        /unit:\s*lengthUnitControl \? "" : unit/,
        "the static unit is suppressed when the selector renders"
    );

    assert.match(
        scalarBody,
        /unitControl:\s*lengthUnitControl/,
        "the selector is rendered beside the number"
    );

    /* The coordinate helper keeps the same rule: one unit statement per row. */
    const coordinateBody = markup.slice(
        markup.indexOf("const coordinate = ("),
        markup.indexOf("const coordinate = (") + 5000
    );

    assert.match(
        coordinateBody,
        /unitControl:\s*lengthUnitControl,?/,
        "the coordinate row renders the selector"
    );

    const coordinateCode = coordinateBody
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");

    assert.match(
        coordinateCode,
        /unit:\s*lengthUnitControl \? "" : converts \? chosenUnit : unit/,
        "the coordinate row suppresses the static unit beside its selector"
    );
});

/*
 * THE TRIANGLE AND THE SUPPORT READ IN THE SAME UNIT as every other
 * length field - a panel with two units for one feature is the drift the
 * shared system exists to prevent.
 */
test("the triangle panel converts vertices and sides into the selected unit", () => {
    const triangle = read("src/editor/triangle-panel.js");

    assert.match(
        triangle,
        /shownLength\(point\.x\)/,
        "vertices are converted"
    );

    assert.match(
        triangle,
        /shownLength\(side\)/,
        "sides are converted"
    );

    assert.match(
        triangle,
        /data-property="lengthUnit"/,
        "the triangle offers the shared unit selector"
    );
});

/*
 * A STATIC VALUE IS NEVER SILENTLY ZERO. The reader refuses an empty or
 * malformed entry, and the binding leaves the last valid state in place.
 */
test("an empty or malformed magnitude is refused, never coerced to zero", () => {
    assert.equal(quantities.readQuantity("", "force", "N"), null);
    assert.equal(quantities.readQuantity("abc", "force", "N"), null);
    assert.equal(quantities.readQuantity("5 furlongs", "force", "N"), null);

    /* A valid zero is a value, and is kept distinct from a refusal. */
    assert.deepEqual(quantities.readQuantity("0", "force", "N"), {
        value: 0,
        unit: "N",
        explicit: false,
    });
});

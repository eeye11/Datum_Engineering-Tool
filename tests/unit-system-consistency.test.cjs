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

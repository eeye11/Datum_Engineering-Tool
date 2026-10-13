/*
 * ========================================================
 * THE PANEL'S OWN MARKUP CARRIES THE CONVERTED NUMBER
 * ========================================================
 *
 * The previous test proves the conversion pair is correct. This one proves
 * the PANEL actually uses it - by building real panel markup on a
 * CALIBRATED sheet and reading the numbers out of the HTML.
 *
 * A source-level test could pass while the panel still printed a raw world
 * number, so the assertion is on the rendered value.
 */

const path = require("path");
const { JSDOM } = require("jsdom");

const projectRoot = path.join(__dirname, "..");

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

const { createHarness } = require("./harness-renderer.cjs");

createHarness(projectRoot, JSDOM, require);

const { modulePath, loadModule } = require("./helpers/source-path.cjs");

const { drawingState } = require(modulePath("editor-state.js"));

loadModule("dimensions.js");

/*
 * A CALIBRATED SHEET: 1 world unit = 4 mm. A raw number that leaked through
 * would be a quarter of the value asserted below.
 */
const MM_PER_UNIT = 4;

drawingState.scale = { mmPerUnit: MM_PER_UNIT, unit: "mm" };

/* The panel builder, extracted and run against real features. */
const panelSource = require("fs").readFileSync(
  modulePath("feature-panel-markup.js"),
  "utf8",
);

/*
 * THE CONVERSION IS THE PANEL'S, AND IT IS ASSERTED THROUGH `mmOf`.
 *
 * `mmOf` is the one helper every panel length and coordinate goes through,
 * so proving it converts proves every field that calls it does.
 */
const { mmOf } = require(modulePath("handles.js"));

check(
  "a stored length of 100 world units reads as 400 mm",
  mmOf(100).value === 400,
  `read as ${mmOf(100).value}`,
);

check(
  "and it reports the sheet's own unit",
  mmOf(100).unit === "mm",
);

/*
 * The coordinate helper and the scalar helper must BOTH convert, or a
 * feature whose position is a coordinate would disagree with one whose
 * position is a length.
 *
 * Both helpers now read in the feature's SELECTED unit: the mm figure from
 * `mmOf` is converted into `chosenUnit` through the shared table, which is
 * the same conversion the setter undoes. Asserting the selected-unit step
 * pins the metre/millimetre round trip end to end.
 */
check(
  "the coordinate helper converts a length into the selected unit",
  /const shown = converts\s*\?\s*enggQuantities\.convertValue\(\s*mm\.value,\s*"length",\s*"mm",\s*chosenUnit\s*\)/.test(
    panelSource,
  ),
  "the coordinate helper does not convert into the selected unit",
);

check(
  "the scalar helper converts a length into the selected unit",
  /const shown = isLength\s*\?\s*enggQuantities\.convertValue\(\s*mmOf\(value\)\.value,\s*"length",\s*"mm",\s*chosenUnit\s*\)/.test(
    panelSource,
  ),
  "the scalar helper does not convert into the selected unit",
);

/*
 * NO PHYSICAL FIELD MAY BE LEFT UNCONVERTED. Every `scalar(...)` that
 * captions a length must either pass `true` for `isLength` or wrap its
 * value in `mmOf` - a bare world number under a "mm" tag is the defect.
 */
const bareMmScalars = [
  ...panelSource.matchAll(
    /scalar\(\s*"(?:Length|Height|Width|Radius|Diameter|Interval|Distance)"[\s\S]{0,160}?"mm"\s*\)/g,
  ),
];

check(
  "no length field prints a raw world number under a mm tag",
  bareMmScalars.length === 0,
  `${bareMmScalars.length} unconverted length field(s): ${bareMmScalars
    .map((m) => m[0].replace(/\s+/g, " ").slice(0, 60))
    .join(" | ")}`,
);

/* Every coordinate call must ask for the conversion. */
/*
 * Comments are stripped first. The helper's own documentation quotes a
 * call - `coordinate("Start X", ...)` - as an example of the label it used
 * to double, and matching that would be a test failing on prose rather than
 * on code.
 */
const panelCode = panelSource
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");

const bareCoordinates = [
  ...panelCode.matchAll(/coordinate\(\s*"[^"]+"\s*,[^)]*?\)/g),
].filter((m) => !/,\s*true\s*\)/.test(m[0]) && !/unit,\s*true/.test(m[0]));

check(
  "every coordinate field asks for the conversion",
  bareCoordinates.length === 0,
  `${bareCoordinates.length} unconverted coordinate(s): ${bareCoordinates
    .map((m) => m[0].replace(/\s+/g, " ").slice(0, 60))
    .join(" | ")}`,
);

/*
 * And the WRITER converts on the way in, so the round trip closes. Without
 * this the panel would show millimetres and store them as world units -
 * which moves a feature four times too far on this sheet.
 */
const updateSource = require("fs").readFileSync(
  modulePath("property-update.js"),
  "utf8",
);

check(
  "the writer converts a typed coordinate to world units",
  /*
   * THE DISPLAY UNIT IS PASSED THROUGH, NOT PRE-CONVERTED.
   *
   * `worldLengthOf(typed, unit)` is the ONE conversion entry point and already
   * forwards the unit to `dimensions.fromEngineering(state, typed, unit)`. So the
   * typed number and the field's unit go in together, and the length crosses the
   * scale EXACTLY ONCE.
   *
   * THIS TEST USED TO PIN THE OPPOSITE, AND THE OPPOSITE IS THE BUG. It demanded
   * a double conversion - `convertValue(value, 'length', displayUnit, 'mm')`
   * followed by `worldLengthOf(millimetres)` - which converted the typed value to
   * millimetres and then handed those millimetres to the scale with no unit, so
   * the scale read them BACK as the display unit and the second pass undid the
   * first. On a field showing inches, typing 2 produced 2 mm instead of 50.8 mm.
   *
   * A test that pins a defect PASSES while the defect is present and fails once it
   * is repaired, which is what happened here. The behavioural checks further down
   * drive the real writer and read the geometry back, so they cannot be satisfied
   * by a plausible-looking call.
   */
  /isLengthCoordinate[\s\S]{0,2500}?worldLengthOf\(\s*value,\s*displayUnit\s*\)/.test(
    updateSource,
  ) &&
    !/worldLengthOf\(\s*millimetres\s*\)/.test(updateSource) &&
    !/convertValue\(\s*value,\s*'length',\s*displayUnit,\s*'mm'\s*\)/.test(
      updateSource,
    ),
  "the writer must pass the display unit straight to worldLengthOf, converting once",
);

check(
  "the writer applies it to the coordinate branches",
  /g\.start\[axis\] = worldValue;/.test(updateSource) &&
    /g\.position\[key\.split\('\.'\)\[1\]\] = worldValue;/.test(updateSource) &&
    /g\.center\[key\.split\('\.'\)\[1\]\] = worldValue;/.test(updateSource),
  "a coordinate branch still writes the raw value",
);

check(
  "and an angle is excluded from it",
  /ANGLES ARE NOT CONVERTED/.test(updateSource) &&
    /LENGTH_AXIS = \/\\\.\(x\|y\)\$\/;/.test(updateSource),
  "the conversion could be applied to an angle",
);

/* The plot Range is a physical length too, and it lives in another panel. */
const staticsSource = require("fs").readFileSync(
  modulePath("statics-panel.js"),
  "utf8",
);

check(
  "the analysis plot Range is converted as well",
  /Range[\s\S]{0,300}enggDimensions\.toEngineering/.test(staticsSource),
  "the plot range prints raw world units",
);

/*
 * ========================================================
 * AND THE ROUND TRIP IS PROVEN THROUGH THE REAL WRITER
 * ========================================================
 *
 * A source-level assertion can only show that the writer is SHAPED correctly.
 * These checks drive `updateFeatureProperty` itself, on a calibrated sheet, and
 * read the geometry back - so a double conversion cannot hide behind a
 * plausible-looking call. This is the exact defect that was found: entering 2
 * in a field reading INCHES produced 2 mm instead of 50.8 mm.
 */
const { updateFeatureProperty } = loadModule("property-update.js");

const INCH_IN_MM = 25.4;

const point = () => ({
  id: "p1",
  type: "point",
  geometry: { position: { x: 0, y: 0 } },
});

/* One sheet, one unit, one typed number: the geometry is the only output. */
const typedInUnit = (unit, typed) => {
  const object = point();

  if (unit) {
    updateFeatureProperty(object, "lengthUnit", unit);
  }

  updateFeatureProperty(object, "position.x", typed);

  /* Back to millimetres through the panel's own reader, to compare like with like. */
  return object.geometry.position.x * MM_PER_UNIT;
};

check(
  "typing 2 in a field reading inches is 50.8 mm on the sheet",
  Math.abs(typedInUnit("in", 2) - 2 * INCH_IN_MM) < 1e-6,
  `got ${typedInUnit("in", 2)} mm, expected ${2 * INCH_IN_MM} mm`,
);

check(
  "the panel's own unit is applied to the entry as well",
  Math.abs(typedInUnit("cm", 2) - 20) < 1e-6 &&
    Math.abs(typedInUnit("m", 2) - 2000) < 1e-6,
  `cm: ${typedInUnit("cm", 2)} mm, m: ${typedInUnit("m", 2)} mm`,
);

check(
  "and with no unit chosen the millimetres go straight through",
  Math.abs(typedInUnit("", 2) - 2) < 1e-6,
  `got ${typedInUnit("", 2)} mm, expected 2 mm`,
);

/*
 * A UNIT THE LENGTH QUANTITY DOES NOT HAVE IS REFUSED, so a coordinate can never
 * be left claiming to be read in a force. The write returns false and the stored
 * unit is untouched.
 */
const refused = point();
const accepted = updateFeatureProperty(refused, "lengthUnit", "kN");

check(
  "a dimensionally incompatible unit is refused",
  accepted === false && !refused.lengthUnit,
  `accepted=${accepted}, stored unit=${refused.lengthUnit}`,
);

/*
 * AN ANGLE IS NOT A LENGTH. Typing a rotation must not cross the scale, or a
 * 45-degree turn would become a 180-degree one on a 4 mm sheet.
 */
const angled = {
  id: "r1",
  type: "rectangle",
  geometry: {
    position: { x: 0, y: 0 },
    width: 10,
    height: 10,
    rotation: 0,
  },
};

updateFeatureProperty(angled, "rotation", 45);

check(
  "rotation is stored in degrees and never converted",
  angled.geometry.rotation === 45,
  `rotated to ${angled.geometry.rotation}, expected 45`,
);

console.log(`\n  ${pass} passed, ${fail} failed\n`);

if (fail) {
  process.exitCode = 1;
}
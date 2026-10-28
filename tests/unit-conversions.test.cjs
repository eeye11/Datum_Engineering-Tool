/*
 * ========================================================
 * THE SHARED UNIT CONVERSION TABLE
 * ========================================================
 *
 * `tests/units.test.cjs` covers what changing a UNIT in a panel means - that it
 * relabels a magnitude and does not rescale it. This file covers the layer
 * underneath: the conversion table itself, and the arithmetic that turns a value
 * in one unit into the same physical value in another.
 *
 * The distinction is worth the second file because the table is now the one
 * place every quantity is defined, across fifteen categories - so a wrong factor
 * here would be a wrong factor in every panel that reads it.
 */

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

const q = require(locate("quantities.js")).default;

const near = (a, b, tolerance = 1e-9) => Math.abs(a - b) <= tolerance;

console.log("\n  a conversion changes the UNIT, not the quantity\n");

check("25.4 mm is 1 inch", near(q.convertValue(25.4, "length", "mm", "in"), 1));
check("1000 mm is 1 metre", near(q.convertValue(1000, "length", "mm", "m"), 1));
check("1 m is 1000 mm", near(q.convertValue(1, "length", "m", "mm"), 1000));
check("1 ft is 12 in", near(q.convertValue(1, "length", "ft", "in"), 12));

check(
  "the same unit is an identity",
  q.convertValue(42, "length", "mm", "mm") === 42,
);

check(
  "an unknown unit is REFUSED, not silently treated as the base",
  q.convertValue(250, "force", "N", "furlong") === 250,
  "a silent factor of one is how 250 N becomes 250 kN",
);

console.log("\n  angles convert, in both directions\n");

check(
  "180° is pi radians",
  near(q.convertValue(180, "angle", "°", "rad"), Math.PI, 1e-12),
);
check(
  "pi radians is 180°",
  near(q.convertValue(Math.PI, "angle", "rad", "°"), 180, 1e-9),
);
check(
  "90° is pi/2 radians",
  near(q.convertValue(90, "angle", "°", "rad"), Math.PI / 2, 1e-12),
);
check(
  "1 radian is 57.2958°",
  near(q.convertValue(1, "angle", "rad", "°"), 57.29577951308232, 1e-9),
  "the factor is degrees-per-radian, not its reciprocal",
);

console.log("\n  AREA and VOLUME use squared and cubed factors\n");

check("100 mm² is 1 cm²", near(q.convertValue(100, "area", "mm²", "cm²"), 1));
check("1 m² is 1e6 mm²", near(q.convertValue(1, "area", "m²", "mm²"), 1e6));
check(
  "1 in² is 645.16 mm²",
  near(q.convertValue(1, "area", "in²", "mm²"), 645.16),
);
check(
  "1000 mm³ is 1 cm³",
  near(q.convertValue(1000, "volume", "mm³", "cm³"), 1),
);
check(
  "1 ft³ is 1728 in³",
  near(q.convertValue(1, "volume", "ft³", "in³"), 1728),
);

console.log("\n  TEMPERATURE is an offset scale, not only a ratio\n");

check(
  "0 °C is 273.15 K",
  near(q.convertValue(0, "temperature", "°C", "K"), 273.15, 1e-9),
  "a factor-only conversion would answer 0 K",
);

check(
  "100 °C is 212 °F",
  near(q.convertValue(100, "temperature", "°C", "°F"), 212, 1e-9),
);
check(
  "212 °F is 100 °C",
  near(q.convertValue(212, "temperature", "°F", "°C"), 100, 1e-9),
);
check(
  "32 °F is 273.15 K",
  near(q.convertValue(32, "temperature", "°F", "K"), 273.15, 1e-9),
);
check(
  "-40 °C is -40 °F",
  near(q.convertValue(-40, "temperature", "°C", "°F"), -40, 1e-9),
);

console.log("\n  the other engineering quantities\n");

check("1 kN is 1000 N", near(q.convertValue(1, "force", "kN", "N"), 1000));
check(
  "1 MPa is ~145.04 psi",
  near(q.convertValue(1, "pressure", "MPa", "psi"), 145.0377, 1e-3),
);
check(
  "1 g/cm³ is 1000 kg/m³",
  near(q.convertValue(1, "density", "g/cm³", "kg/m³"), 1000),
);
check(
  "1 lb is 0.45359 kg",
  near(q.convertValue(1, "mass", "lb", "kg"), 0.45359237, 1e-9),
);

console.log("\n  only COMPATIBLE units are offered\n");

check(
  "length offers its five units, base first",
  q.unitsFor("length").join(",") === "mm,cm,m,in,ft",
  q.unitsFor("length").join(","),
);

check(
  "angle offers degrees and radians",
  q.unitsFor("angle").join(",") === "°,rad",
);

check(
  "a force unit is not a length unit",
  q.isUnitFor("length", "kN") === false && q.isUnitFor("force", "kN") === true,
);

check(
  "an unknown quantity offers NOTHING",
  q.unitsFor("nonsense").length === 0,
  "a caller must not be handed another quantity's units",
);

check(
  "every unit list starts with the quantity's base",
  Object.entries(q.QUANTITY_UNITS).every(
    ([, quantity]) => Object.keys(quantity.units)[0] === quantity.base,
  ),
  "the base is what the model stores, so it is the default",
);

console.log("\n  repeated conversion does not drift\n");

{
  let value = 123.456;

  for (let round = 0; round < 50; round += 1) {
    value = q.convertValue(value, "length", "mm", "ft");
    value = q.convertValue(value, "length", "ft", "mm");
  }

  check(
    "50 round trips through feet leave the value as it was",
    near(value, 123.456, 1e-9),
    String(value),
  );
}

console.log("\n  a conversion is refused rather than defaulted\n");

check(
  "an unknown QUANTITY leaves the value alone",
  q.convertValue(5, "nonsense", "mm", "in") === 5,
);

check(
  "and one known unit of the two is not enough",
  q.convertValue(5, "length", "mm", "kg") === 5,
);

console.log("\n  every category the application states a quantity in\n");

check(
  "fifteen categories are defined",
  Object.keys(q.QUANTITY_UNITS).length === 15,
  Object.keys(q.QUANTITY_UNITS).join(","),
);

check(
  "each carries at least one unit, and a base that is one of them",
  Object.values(q.QUANTITY_UNITS).every(
    (quantity) =>
      Object.keys(quantity.units).length > 0 &&
      Boolean(quantity.units[quantity.base]),
  ),
);

console.log(`\n  ${pass} passed, ${fail} failed\n`);

if (fail) {
  process.exitCode = 1;
}

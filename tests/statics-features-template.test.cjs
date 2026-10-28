/*
 * ========================================================
 * THE STATICS FEATURES TAB FOLLOWS THE TEAM TEMPLATE
 * ========================================================
 *
 *   Object       Name, Fix                (Visibility is not built yet)
 *   Appearance   Line Style, Outline Colour, Thickness, Fill
 *   Transform    X Shift, Y Shift, Rotate, then the tool's own values
 *
 * Every Statics object used to show only Label and Show Name: no Appearance,
 * Fix on two types, no Transform on a support and no way to restate a
 * magnitude. This pins the template, and the two rules that make its values
 * honest - a typed magnitude is a LABEL (the drawn arrow keeps its length), and
 * the label states it in the unit the student chose.
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

const src = (file) => require(locate(path.basename(file)));

const model = src("drawing-state.js").default;
const schema = src("feature-schema.js");
const { serializeStaticsObject } = src("statics.js");

const f = model.geometryFactories;
const P = (x, y) => ({ x, y });

const fieldsOf = (object) =>
  Object.fromEntries(schema.groupsFor(object).map((group) => [group.id, group.fields.map((field) => field.key)]));

const STATICS = {
  particle: f.particle(P(0, 0), {}),
  "rigid-body": f["rigid-body"](P(0, 0), 40, 20, {}),
  beam: f.beam(P(0, 0), P(100, 0), {}),
  truss: f.truss(P(0, 0), P(100, 0), {}),
  cable: f.cable(P(0, 0), P(100, 0), {}),
  shaft: f.shaft(P(0, 0), P(100, 0), {}),
  force: f.force(P(0, 0), P(0, 50), {}),
  moment: f.moment(P(0, 0), 10, "CW", {}),
  load: f.load(P(0, 0), P(100, 0), 5, {}),
  "pin-support": f["pin-support"](P(0, 0), {}),
  "fixed-support": f["fixed-support"](P(0, 0), {}),
  "pin-connection": f["pin-connection"](P(0, 0), P(10, 0), {}),
  resultant: f.resultant(P(0, 0), P(30, 40), {}),
};

console.log("\n  every Statics object has Object and Appearance\n");

Object.entries(STATICS).forEach(([type, object]) => {
  const fields = fieldsOf(object);

  check(
    `${type}: Object holds Name and Fix`,
    (fields.object || []).includes("name") && (fields.object || []).includes("fixed"),
    JSON.stringify(fields),
  );

  check(
    `${type}: Appearance holds Outline Colour`,
    (fields.appearance || []).includes("stroke"),
    JSON.stringify(fields),
  );
});

console.log("\n  and only the controls the drawing shows\n");

["beam", "shaft", "rigid-body", "force", "load", "resultant"].forEach((type) => {
  check(
    `${type}: Line Style and Thickness`,
    ["staticsLineType", "lineWidth"].every((key) => fieldsOf(STATICS[type]).appearance.includes(key)),
    JSON.stringify(fieldsOf(STATICS[type])),
  );
});

check(
  "a moment keeps Thickness but not Line Style (its arc is always solid)",
  fieldsOf(STATICS.moment).appearance.includes("lineWidth") &&
    !fieldsOf(STATICS.moment).appearance.includes("staticsLineType"),
);

["particle", "truss", "cable", "pin-support", "fixed-support", "pin-connection"].forEach((type) => {
  check(
    `${type}: a fixed symbol - no Line Style or Thickness`,
    !["staticsLineType", "lineWidth"].some((key) => fieldsOf(STATICS[type]).appearance.includes(key)),
    JSON.stringify(fieldsOf(STATICS[type])),
  );
});

check(
  "Object comes before Appearance",
  schema.groupsFor(STATICS.beam).findIndex((group) => group.id === "object") <
    schema.groupsFor(STATICS.beam).findIndex((group) => group.id === "appearance"),
);

check(
  "a Beam offers Fill",
  fieldsOf(STATICS.beam).appearance.includes("staticsFillMode"),
);

check(
  "a support symbol does not",
  !fieldsOf(STATICS["pin-support"]).appearance.includes("staticsFillMode"),
);

check(
  "an arrow does not",
  !fieldsOf(STATICS.force).appearance.includes("staticsFillMode") &&
    !fieldsOf(STATICS.particle).appearance.includes("staticsFillMode"),
);

check(
  "Geometry's Line and Fill sections are not leaked onto a Statics object",
  !("line" in fieldsOf(STATICS.force)) && !("fill" in fieldsOf(STATICS["pin-support"])),
);

check(
  "an empty name is refused",
  !schema.writeField(JSON.parse(JSON.stringify(STATICS.beam)), "name", "   "),
);

console.log("\n  each changes the drawing\n");

const restyled = JSON.parse(JSON.stringify(STATICS.beam));

schema.writeField(restyled, "stroke", "#CC0000");
schema.writeField(restyled, "staticsLineType", "dashed");
schema.writeField(restyled, "staticsFillMode", "solid");

const restyledSource = serializeStaticsObject(restyled);

check("the outline colour reaches the source", /CC0000/i.test(restyledSource), restyledSource);
check("and the line style", /dash/.test(restyledSource), restyledSource);
check("and the fill", /fill=/.test(restyledSource), restyledSource);

console.log("\n  the tool's own values sit in Transform\n");

check("a force: Magnitude, Unit, Angle", ["forceMagnitude", "forceUnit", "forceAngle"].every((key) => fieldsOf(STATICS.force)["statics-values"].includes(key)));
check("a moment: Magnitude, Unit, Direction", ["momentMagnitude", "momentUnit", "momentDirection"].every((key) => fieldsOf(STATICS.moment)["statics-values"].includes(key)));
check("a uniform load: Intensity and Unit", ["loadIntensity", "loadUnit"].every((key) => fieldsOf(STATICS.load)["statics-values"].includes(key)));

const profiled = JSON.parse(JSON.stringify(STATICS.load));

profiled.geometry.points = [
  { t: 0, magnitude: 2 },
  { t: 1, magnitude: 6 },
];

check(
  "a load whose points differ is edited point by point",
  fieldsOf(profiled)["statics-values"].includes("loadPoint:1") &&
    !fieldsOf(profiled)["statics-values"].includes("loadIntensity"),
  JSON.stringify(fieldsOf(profiled)),
);

const editor = fs.readFileSync(locate("features-editor.js"), "utf8");

check(
  "the pane writes those rows inside the Transform section",
  /group\.transformValues[\s\S]{0,80}?valueRows \+= rows/.test(editor) &&
    /transformRowMarkup\("rotate", "Rotate"\)[\s\S]{0,80}?valueRows/.test(editor),
);

console.log("\n  a typed magnitude is a label, in the chosen unit\n");

const force = JSON.parse(JSON.stringify(STATICS.force));
const drawnBefore = Math.hypot(force.geometry.end.x - force.geometry.start.x, force.geometry.end.y - force.geometry.start.y);

schema.writeField(force, "forceUnit", "kN");
schema.writeField(force, "forceMagnitude", 2.5);

const drawnAfter = Math.hypot(force.geometry.end.x - force.geometry.start.x, force.geometry.end.y - force.geometry.start.y);

check("2.5 typed in kN is stored as 2500 N", Math.abs(force.geometry.magnitude - 2500) < 1e-6, force.geometry.magnitude);
check("and reads back as 2.5", schema.readField(force, "forceMagnitude") === 2.5);
check("the drawn arrow keeps its length", Math.abs(drawnBefore - drawnAfter) < 1e-6, `${drawnBefore} -> ${drawnAfter}`);
check("the label says 2.5 kN, not 2500 kN", /F = 2\.5\\ kN/.test(serializeStaticsObject(force)), serializeStaticsObject(force));

const moment = JSON.parse(JSON.stringify(STATICS.moment));

schema.writeField(moment, "momentUnit", "kN·m");

check(
  "a moment's chosen unit is the one its label states",
  /M = 0\.01\\ kN/.test(serializeStaticsObject(moment)),
  serializeStaticsObject(moment),
);

console.log("\n  a support is offered Transform\n");

const beam = f.beam(P(0, 0), P(100, 0), {});
const support = f["pin-support"](P(100, -6), {});

beam.id = "beam-under";
support.parentId = beam.id;
support.geometry.attachment = { fraction: 1, unit: "fraction" };

const lookup = (id) => (id === beam.id ? beam : null);

check("an attached support moves when its body is known", schema.supportsTransform(support, lookup));
check("even at the far end of the body, where one direction is clamped", schema.wouldMove(support, lookup));
check("every Statics object can be fixed", Object.values(STATICS).every((object) => schema.readField(object, "fixed") === false));

console.log(`\n  ${pass} passed, ${fail} failed\n`);

if (fail) {
  process.exitCode = 1;
}

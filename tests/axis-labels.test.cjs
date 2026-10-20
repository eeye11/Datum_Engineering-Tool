/*
 * ========================================================
 * COORDINATE-SYSTEM AXIS LABELS
 * ========================================================
 *
 * A coordinate system carries an X label and a Y label. The rules that matter,
 * all of which come from the same underlying distinction - a DEFAULT is not a
 * PLACEHOLDER:
 *
 *   - "X" and "Y" are written into the document when the feature is CREATED.
 *     From then on the stored text is authoritative.
 *   - An EMPTY label is a real state: the student has said there is no label
 *     here. It must stay empty, and nothing may restore the default.
 *   - The labels are independent: editing or moving one never touches the other.
 *   - Their positions are stored separately from the axis geometry, so moving a
 *     label cannot move the coordinate system.
 *
 * The default-vs-empty rule is the one worth failing over. If clearing a label
 * brought "X" back, the field would be unusable - the user could never express
 * "no label", and every save would silently undo their choice.
 */

const fs = require("fs");

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

const creation = fs.readFileSync(locate("geometry-creation.js"), "utf8");
/* The Features pane's own X/Y label fields - what the student types into. */
const schema = require(locate("feature-schema.js"));
const axes = () => ({ type: "coordinate-system-2d", geometry: { origin: { x: 0, y: 0 }, showLabels: true } });
const render = fs.readFileSync(locate("canvas-render.js"), "utf8");

console.log("\n  the defaults are written at creation, once\n");

check(
  "a new coordinate system stores an X and a Y label",
  /xLabel:\s*"X"/.test(creation) && /yLabel:\s*"Y"/.test(creation),
  "the defaults must be STORED, not assumed at draw time",
);

check(
  "and stores no label position, so each starts at its automatic place",
  /xLabelPosition:\s*null/.test(creation) &&
    /yLabelPosition:\s*null/.test(creation),
);

console.log("\n  an empty label stays empty\n");

{
  const object = axes();

  schema.fieldDefinition("xLabel").write(object, "");
  schema.fieldDefinition("yLabel").write(object, "");

  check(
    "clearing the field stores an empty string",
    object.geometry.xLabel === "" && object.geometry.yLabel === "",
    "an empty label must be stored as empty, not dropped",
  );

  check(
    "and the panel reads it back as empty, NOT as the default",
    schema.readField(object, "xLabel") === "" && schema.readField(object, "yLabel") === "",
    "substituting a default here is what would resurrect a cleared label",
  );
}

console.log("\n  an empty label draws nothing\n");

check(
  "the renderer skips a label with no text",
  /if \(!text\.trim\(\)\)\s*\{\s*return;/.test(render),
  "drawing a fallback would overrule the student",
);

check(
  "the hard-coded +X/-X/+Y/-Y strings are gone",
  !/"\+X"/.test(render) &&
    !/"-X"/.test(render) &&
    !/"\+Y"/.test(render) &&
    !/"-Y"/.test(render),
);

console.log("\n  a label position is independent of the geometry\n");

check(
  "a stored position is used when there is one",
  /Number\.isFinite\(manual\?\.x\) \? manual\.x : automatic\.x/.test(render),
  "a moved label must stay where it was put",
);

check(
  "the label position is separate from the origin and axis lengths",
  /xLabelPosition/.test(render) &&
    /geometry\.xLabelPosition/.test(render) &&
    !/origin\s*=\s*geometry\.xLabelPosition/.test(render),
  "moving a label must never move the coordinate system",
);

console.log("\n  the two labels are independent\n");

check(
  "X and Y are read, drawn and written separately",
  /appendAxisLabel\(\s*xText/.test(render) &&
    /appendAxisLabel\(\s*yText/.test(render),
);

{
  const object = axes();

  object.geometry.yLabel = "Fy";
  schema.fieldDefinition("xLabel").write(object, "Fx");

  check(
    "a label edits only its own stored text",
    object.geometry.xLabel === "Fx" && object.geometry.yLabel === "Fy",
    "one write, keyed by which label was edited",
  );
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);

if (fail) {
  process.exitCode = 1;
}

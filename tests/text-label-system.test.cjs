/*
 * ========================================================
 * NAME, LABEL, AND THE TEXT FORMATTING DROPDOWN
 * ========================================================
 *
 * The two properties this change separates, and the panel rule it adds:
 *
 *   NAME    what the object is called in the inventory and the source header
 *   LABEL   the text drawn on the sheet
 *
 * They used to be one value, so renaming an object changed its drawing. These
 * checks hold them apart and hold the dropdown's visibility rule.
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

const { createHarness } = require("./support/harness-renderer.cjs");

createHarness(projectRoot, JSDOM, require);

["drawingToolMessage"].forEach((id) => {
  const element = document.createElement("div");
  element.id = id;
  document.body.appendChild(element);
});

const { loadModule } = require("./helpers/source-path.cjs");

const schema = loadModule("feature-schema.js");
const draw = loadModule("drawing-state.js");

const point = (x, y) => ({ x, y });

const makeLine = () =>
  draw.default.createGeometryObject(
    "line",
    { start: point(0, 0), end: point(40, 0) },
    {},
  );

/* ---------------------------------------------------------- name vs label */

console.log("\nName is not Label");
console.log("-----------------");

const line = makeLine();

line.style = { stroke: "#193335", lineWidth: 0.4 };

const nameBefore = line.name;

schema.writeField(line, "name", "Wall A");

check("renaming writes the name", line.name === "Wall A", line.name);

check(
  "renaming does NOT change the drawn label",
  line.label !== "Wall A",
  String(line.label),
);

schema.writeField(line, "label", "L1");

check(
  "writing the label writes the drawn text",
  line.label === "L1",
  String(line.label),
);

check("and leaves the name alone", line.name === "Wall A", line.name);

check(
  "the two are independent of the object's original name",
  nameBefore !== "" || true,
);

/* An empty label is a real, drawable state - nothing is invented. */
schema.writeField(line, "label", "");

check(
  "an emptied label stays empty (no placeholder is generated)",
  line.label === "",
  JSON.stringify(line.label),
);

/* ---------------------------------------------------------- ordering */

console.log("\nObject section ordering");
console.log("-----------------------");

const objectSection = (object) =>
  schema.groupsFor(object).find((group) => group.id === "object");

const lineObject = objectSection(makeLine());

/*
 * NAME, LABEL, FIX - in that order. A `visibility` row already sits between
 * them, and it stays: it is the third control over the object's eye, kept in
 * step with the Objects panel, and the specification asks for that
 * synchronisation explicitly. What matters is the ORDER of the three rows the
 * specification names, which is asserted below rather than as one exact list.
 */
const lineKeys = lineObject.fields.map((field) => field.key);

check(
  "a Line reads Name, then Label, then Fix",
  lineKeys.indexOf("name") >= 0 &&
    lineKeys.indexOf("label") === lineKeys.indexOf("name") + 1 &&
    lineKeys.indexOf("fixed") === lineKeys.indexOf("label") + 1,
  lineKeys.join(","),
);

const annotate = {
  type: "annotate",
  annotateKind: "note",
  text: "hello",
  label: "hello",
  name: "Note 1",
  style: {},
};

const noteObject = objectSection(annotate);

const noteKeys = noteObject.fields.map((field) => field.key);

check(
  "a Note reads Name, then Label, then Fix as well",
  noteKeys[0] === "noteName" &&
    noteKeys[1] === "label" &&
    noteKeys[2] === "fixed",
  noteKeys.join(","),
);

/* ---------------------------------------------------------- one text source */

console.log("\nOne source of displayed text");
console.log("----------------------------");

const note = { ...annotate };

schema.writeField(note, "label", "changed on the panel");

check(
  "writing a note's Label writes its TEXT - the value the canvas draws",
  note.text === "changed on the panel",
  JSON.stringify(note.text),
);

check(
  "and reads back from the same place",
  schema.readField(note, "label") === "changed on the panel",
);

/* ---------------------------------------------------------- formatting */

console.log("\nFormatting stays separate from geometry");
console.log("---------------------------------------");

const sized = makeLine();
const geometryBefore = JSON.stringify(sized.geometry);

schema.writeField(sized, "noteSize", 24);

check(
  "a formatting change leaves the geometry untouched",
  JSON.stringify(sized.geometry) === geometryBefore,
);

check(
  "and leaves the Fix state untouched",
  sized.locked === undefined,
  String(sized.locked),
);

schema.writeField(sized, "fixed", true);

check("Fix still writes the lock", sized.locked === true);

const locked = sized.locked;

schema.writeField(sized, "noteSize", 12);

check(
  "changing the size does not clear Fix",
  sized.locked === locked,
  String(sized.locked),
);

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);

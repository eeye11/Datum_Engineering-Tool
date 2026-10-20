/*
 * An Arrow, Leader or Callout's arrowhead is chosen in the Features tab.
 *
 * The choice lived on `style.arrowhead` and was drawn by both the renderer and
 * the source writer, but no panel offered it after the old Features panel was
 * retired. These check the field is offered for exactly those kinds and writes
 * only the arrowhead.
 */

const { JSDOM } = require("jsdom");
const { locate } = require("./helpers/source-path.cjs");

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

const schema = require(locate("feature-schema.js"));

const annotate = (kind, arrowhead) => ({
  id: `${kind}-1`,
  type: "annotate",
  annotateKind: kind,
  geometry: {},
  style: { stroke: "#000000", arrowhead },
});

const offered = (object) =>
  schema.groupsFor(object).some((group) => group.fields.some((field) => field.key === "arrowhead"));

console.log("\n  the arrowhead field\n");

check("a Leader offers it", offered(annotate("leader", "closed")));
check("an Arrow offers it", offered(annotate("arrow", "closed")));
check("a Callout offers it", offered(annotate("callout", "none")));
check("a Note does not", !offered(annotate("note", "none")));
check("a Line does not (it has Begin/End Arrow)", !offered({ id: "l", type: "line", geometry: {}, style: {} }));

const leader = annotate("leader", "closed");

check("it reads the stored head", schema.readField(leader, "arrowhead") === "closed");
check("it writes an open head", schema.writeField(leader, "arrowhead", "open") && leader.style.arrowhead === "open");
check("and leaves the rest of the style alone", leader.style.stroke === "#000000");
check("it refuses an unknown value", schema.writeField(leader, "arrowhead", "bar") === false && leader.style.arrowhead === "open");
check("its label is Arrowhead", schema.fieldLabel(schema.fieldDefinition("arrowhead"), "arrowhead") === "Arrowhead");

console.log(`\n${pass} passed, ${fail} failed\n`);

if (fail) {
  process.exitCode = 1;
}

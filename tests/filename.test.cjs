/*
 * ========================================================
 * THE FILENAME IS THE USER'S NAME PLUS .TEX
 * ========================================================
 *
 * A drawing is saved as a .tex (the retired .enggdraw is only ever opened).
 *
 * The most damaging possible mistake here is subtle: a saved drawing named
 * `triangle` becoming `triangle.DAETUM drawing (.tex)` or
 * `DAETUM drawing (*.tex)`. The file would still be written and would still open,
 * so nothing would obviously break - the user would simply have a file with a
 * nonsense name, and every later save would build on it.
 *
 * The cause is always the same conflation: a DESCRIPTIVE LABEL, which belongs
 * in the file picker's type control, being used as the EXTENSION. These checks
 * separate the two and pin them apart.
 */

const { JSDOM } = require("jsdom");

const { modulePath } = require("./helpers/source-path.cjs");

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

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  pretendToBeVisual: true,
  url: "https://datum.test/",
});

global.window = dom.window;
global.document = dom.window.document;
global.Blob = dom.window.Blob;
global.URL = dom.window.URL;

const file = require(modulePath("document-file.js")).default;
const save = require(modulePath("file-save.js")).default;

const EXTENSION = file.EXTENSION;

console.log("\n  a drawing's extension is .tex\n");

check(
  "the format's extension is exactly .tex",
  EXTENSION === "tex",
  EXTENSION,
);

check(
  "and it is a bare identifier",
  /^[a-z]+$/.test(EXTENSION),
  "an identifier with punctuation or parentheses is not an extension",
);

console.log("\n  a user's name becomes name.tex\n");

{
  const cases = [
    ["triangle", "triangle.tex"],
    ["My Statics Assignment", "My Statics Assignment.tex"],
    ["triangle.tex", "triangle.tex"],
    ["Beam Diagram", "Beam Diagram.tex"],
    ["", "drawing.tex"],
    /* An imported .enggdraw is saved beside itself as a .tex, never over it. */
    ["triangle.enggdraw", "triangle.tex"],
  ];

  cases.forEach(([input, expected]) => {
    const actual = file.withExtension(input);

    check(`"${input}" -> "${expected}"`, actual === expected, actual);
  });
}

console.log("\n  the picker LABEL never reaches a filename\n");

{
  /*
   * The exact strings that must never appear in a saved name. The label is a
   * description for the operating system's type control; the extension is what
   * goes on the file.
   */
  const forbidden = [
    "EnggDraw (",
    "(*.enggdraw)",
    "(*.tex)",
    "DAETUM drawing (",
    ".enggdraw",
    /*
     * The label names the FORMAT, never the product - both the former name and
     * the current one are forbidden in a filename, so a later edit cannot
     * reintroduce either as a file type.
     */
    "Datum Drawing",
    "DAETUM Drawing",
  ];

  const names = [
    "triangle",
    "My Statics Assignment",
    "triangle.enggdraw",
    "Beam.tex",
    "",
  ].map((name) => file.withExtension(name));

  forbidden.forEach((bad) => {
    check(
      `no produced name contains "${bad}"`,
      !names.some((name) => name.includes(bad)),
      names.join(", "),
    );
  });

  /*
   * And the same through the save module's own naming, which is what the
   * download route and the picker's suggested name both use.
   */
  const normalised = [
    save.normaliseName("triangle", {
      id: "tex",
      extensions: [`.${EXTENSION}`],
    }),
    save.normaliseName("My Statics Assignment", {
      id: "tex",
      extensions: [`.${EXTENSION}`],
    }),
  ];

  check(
    "the save module produces triangle.tex",
    normalised[0] === "triangle.tex",
    normalised[0],
  );

  check(
    "and never a descriptive label",
    !normalised.some((name) => /drawing \(|\*\.tex/.test(name)),
    normalised.join(", "),
  );
}

console.log("\n  the picker's TYPE label is a separate thing\n");

{
  const types = save.fileTypes();

  check(
    "a type is offered for the native format",
    Array.isArray(types) && types.length >= 1,
  );

  const native = types[0];

  check(
    "its description names the format and the extension",
    /DAETUM drawing/.test(native.description) &&
      /\.tex/.test(native.description),
    native.description,
  );

  check(
    "but its ACCEPT list holds the real extension",
    JSON.stringify(Object.values(native.accept).flat()).includes(".tex"),
    JSON.stringify(native.accept),
  );

  /*
   * The accept list is what filters the picker. It must be an extension, not a
   * label - this is the precise line where the two get confused.
   */
  const accepted = Object.values(native.accept).flat();

  check(
    "and every accepted value is a bare extension",
    accepted.every((value) => /^\.[a-z0-9]+$/i.test(value)),
    accepted.join(", "),
  );
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);

if (fail) {
  process.exitCode = 1;
}

void dom;

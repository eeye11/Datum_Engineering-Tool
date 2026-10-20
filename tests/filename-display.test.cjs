/*
 * ========================================================
 * THE .ENGGDRAW EXTENSION IS HIDDEN FROM THE NORMAL UI
 * ========================================================
 *
 * The physical file is `triangle.enggdraw`. Everywhere Datum TALKS about the
 * drawing - the header, a recent file, a template - it is `triangle`.
 *
 * THE RULE IS A DISPLAY RULE, and it is applied where the name is SHOWN rather
 * than only where it is written. A display rule that depends on every writer
 * having remembered it is a rule that holds until the first writer forgets - and
 * there are several: opening, importing, Save As, adding a template, renaming
 * one, and any file written by an older build.
 *
 * ONLY THE FINAL `.enggdraw` GOES. `Statics.V2.Final.enggdraw` reads
 * `Statics.V2.Final`, because the rest of the name is the user's and this rule
 * has no business editing it.
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

const recents = require(modulePath("recent-files.js")).default;
const templates = require(modulePath("templates.js")).default;

console.log("\n  only the final extension is removed\n");

{
  const cases = [
    ["triangle.enggdraw", "triangle"],
    ["my-assignment.enggdraw", "my-assignment"],
    ["beam_test_01.enggdraw", "beam_test_01"],
    ["Statics.V2.Final.enggdraw", "Statics.V2.Final"],
    ["triangle", "triangle"],
    ["", "drawing"],
  ];

  cases.slice(0, 5).forEach(([input, expected]) => {
    const actual = recents.labelFor(input);

    check(`"${input}" -> "${expected}"`, actual === expected, actual);
  });

  check(
    "an empty name falls back rather than becoming an empty label",
    recents.labelFor("") === "drawing",
    recents.labelFor(""),
  );
}

console.log("\n  a template shows its name without the extension\n");

{
  const cases = [
    ["statics.enggdraw", "statics"],
    ["Beam Setup.enggdraw", "Beam Setup"],
    ["Statics.V2.Final.enggdraw", "Statics.V2.Final"],
    ["statics", "statics"],
  ];

  cases.forEach(([input, expected]) => {
    const actual = templates.displayName(input);

    check(`"${input}" -> "${expected}"`, actual === expected, actual);
  });

  check(
    "the extension is matched case-insensitively",
    templates.displayName("Statics.ENGGDRAW") === "Statics",
    templates.displayName("Statics.ENGGDRAW"),
  );
}

console.log("\n  a stored name with the extension is still shown clean\n");

{
  /*
   * A template whose stored name arrived with the extension - typed by a user,
   * or written by an older build - must still DISPLAY without it. This is the
   * point of a display rule.
   */
  templates.clear();

  const id = templates.addTemplate({
    name: "legacy.enggdraw",
    document: {
      units: "mm",
      sheets: [{ id: "s", name: "S", objects: [] }],
      activeSheetId: "s",
    },
  });

  check("the template is stored", Boolean(id));

  const listed = templates.list();

  check(
    "and LISTED without the extension",
    listed[0] && listed[0].name === "legacy",
    listed[0] ? listed[0].name : "nothing listed",
  );

  templates.clear();
}

console.log("\n  the extension is still used for the FILE\n");

{
  const fs = require("fs");

  const file = fs.readFileSync(modulePath("document-file.js"), "utf8");

  check(
    "a drawing's extension is .tex (the retired .enggdraw is import-only)",
    /const EXTENSION = "tex"/.test(file) && /const LEGACY_EXTENSION = "enggdraw"/.test(file),
  );

  const save = fs.readFileSync(modulePath("file-save.js"), "utf8");

  check(
    "Save As still names the file with it",
    /extensions: \[`\.\$\{file\.EXTENSION\}`\]/.test(save) ||
      /`\.\$\{enggDocumentFile\.EXTENSION\}`/.test(save),
    "hiding the extension is a display rule, not a format change",
  );

  const commands = fs.readFileSync(modulePath("document-commands.js"), "utf8");

  check(
    "the header strips it too, from the same kind of rule",
    /function displayNameFor\(fileName\)/.test(commands),
  );
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);

if (fail) {
  process.exitCode = 1;
}

void dom;

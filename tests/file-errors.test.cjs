/*
 * ========================================================
 * FILE PROBLEMS ARE HANDLED, NOT CRASHED
 * ========================================================
 *
 * Every way a file can fail has to end in a message and an UNCHANGED drawing -
 * never an exception, never a blank workspace, never a lost drawing:
 *
 *   unreadable        the browser cannot read it (permissions, a dead drive)
 *   empty             0 bytes: nothing to open, and a different problem from
 *                     "damaged" because the answer is different
 *   not-json          text that is not a drawing at all
 *   wrong-format      JSON that is not a DAETUM document
 *   from-the-future   written by a newer build
 *   too-old           below the minimum this build supports
 *   no-document-body  a valid envelope with nothing in it
 *
 * TWO RULES THE IMPLEMENTATION MUST KEEP, both of which were once broken:
 *
 *   1. `window.alert` IS NOT USED. It blocks the page, cannot be styled, and
 *      THROWS where dialogs are suppressed - so a handled error becomes an
 *      uncaught one, and the failure being reported is replaced by a worse one
 *      from the reporting itself.
 *
 *   2. A file problem NEVER touches the open document. The read and the
 *      validation both happen before anything is applied.
 */

const { JSDOM } = require("jsdom");
const fs = require("fs");

const { loadModule, modulePath, locate } = require("./helpers/source-path.cjs");

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

loadModule("document-file.js");
loadModule("file-save.js");

const file = global.window.enggDocumentFile;

console.log("\n  every bad file is refused with a REASON\n");

{
  /*
   * Each case names what went wrong, because the user's next action depends on
   * which it is: choose another file, use a different tool, or update Datum.
   */
  const cases = [
    {
      name: "not a drawing at all",
      payload: { hello: "world" },
      expect: /not a DAETUM drawing/i
    },
    {
      name: "an envelope with no document",
      payload: { format: "enggdraw", version: 2 },
      expect: /no drawing/i
    },
    {
      name: "from a newer build",
      payload: { format: "enggdraw", version: 99, document: {} },
      expect: /newer version/i
    },
    {
      name: "from before this build supports",
      payload: { format: "enggdraw", version: 0, document: {} },
      expect: /too old/i
    },
    {
      name: "no version stated",
      payload: { format: "enggdraw", document: {} },
      expect: /version/i
    }
  ];

  cases.forEach(({ name, payload, expect }) => {
    const result = file.readDocument(payload);

    check(
      `${name}: refused`,
      result.ok === false,
      JSON.stringify(result)
    );

    check(
      `${name}: the reason is specific`,
      typeof result.detail === "string" && expect.test(result.detail),
      result.detail
    );
  });
}

console.log("\n  a valid file is still accepted\n");

{
  const good = file.createDocument({
    units: "mm",
    sheets: [
      { id: "s1", name: "Sheet 1", objects: [{ id: "o", type: "line" }] }
    ],
    activeSheetId: "s1"
  });

  const result = file.readDocument(JSON.parse(JSON.stringify(good)));

  check("a good file opens", result.ok === true, JSON.stringify(result.failure));

  check(
    "and is not reported as anything else",
    result.detail === undefined || result.detail === null,
    String(result.detail)
  );
}

console.log("\n  readDocument NEVER throws - whatever it is handed\n");

{
  const nasty = [
    null,
    undefined,
    42,
    "a string",
    [],
    {},
    { format: null, version: null },
    { format: "enggdraw", version: "not a number" },
    { format: "enggdraw", version: 2, document: null },
    { format: "enggdraw", version: 2, document: { sheets: "not an array" } },
    { format: "enggdraw", version: 2, document: { sheets: [null, 3] } }
  ];

  let threw = null;

  nasty.forEach((payload) => {
    try {
      const result = file.readDocument(payload);

      if (result.ok !== true && typeof result.detail !== "string") {
        threw = `no reason given for ${JSON.stringify(payload)}`;
      }
    } catch (error) {
      threw = `${JSON.stringify(payload)} threw: ${error.message}`;
    }
  });

  check(
    "no input makes validation throw",
    threw === null,
    threw || ""
  );
}

console.log("\n  the file layer swallows nothing silently\n");

{
  const written = fs.readFileSync(locate("document-commands.js"), "utf8");

  check(
    "every file problem goes through ONE reporter",
    (written.match(/function reportFileProblem\(/g) || []).length === 1,
    "a second definition silently overrides the first",
  );

  check(
    "and that reporter cannot itself throw",
    /function reportFileProblem\(message, context = \{\}\)[\s\S]{0,900}catch \(error\)[\s\S]{0,200}reportError/.test(
      written
    ),
    "reporting a failure must not be able to cause one",
  );

  check(
    "the reporter records the file it was about",
    /reportError\("open file", new Error\(detail\), context\)/.test(written),
  );

  check(
    "window.alert is NOT used anywhere in the file commands",
    !/^\s*window\.alert\(/m.test(written),
    "an alert blocks the page and can throw where dialogs are suppressed",
  );
}

console.log("\n  the specific cases are all handled\n");

{
  const written = fs.readFileSync(locate("document-commands.js"), "utf8");

  check(
    "an EMPTY file is caught by size, before parsing",
    /size === 0[\s\S]{0,400}empty-file/.test(written),
    "an empty file is not \"damaged\" - it is empty",
  );

  check(
    "an unreadable file is reported",
    /failure: reader\.error\?\.name \|\| "read"/.test(written),
  );

  check(
    "choosing a folder is caught, not thrown",
    /readAsText\(file\)[\s\S]{0,900}catch \(error\)/.test(written),
    "readAsText throws on a directory rather than firing `error`",
  );

  check(
    "text that is not JSON is reported by name",
    /is not a DAETUM drawing/.test(written),
  );

  check(
    "a missing recent file is MARKED, not deleted",
    /markMissing\(entry\.key\)[\s\S]{0,400}reportFileProblem/.test(written),
    "the row must stay, with a working menu, so it can be removed or reopened",
  );

  check(
    "and the message says what may have happened",
    /could not be found[\s\S]{0,200}moved/.test(written) ||
      /moved, ` +\n\s+"renamed or deleted/.test(written),
    "the user is told the file may have moved rather than left guessing",
  );

  check(
    "a failed SAVE uses the same reporter and stays dirty",
    /saved\.error[\s\S]{0,400}reportFileProblem[\s\S]{0,200}return false;/.test(
      written
    ),
  );
}

console.log("\n  a rejected file leaves the open drawing alone\n");

{
  const written = fs.readFileSync(locate("document-commands.js"), "utf8");

  check(
    "validation happens BEFORE anything is applied",
    /const result =\s*\n?\s*enggDocumentFile\.readDocument\(/.test(written) &&
      /if \(!result\.ok\)[\s\S]{0,300}reportFileProblem/.test(written),
    "the document is only touched after the file has been accepted",
  );

  check(
    "and the messages say so, so the user is not left wondering",
    /has not been changed/.test(written),
  );
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);

if (fail) {
  process.exitCode = 1;
}

void modulePath;
void dom;

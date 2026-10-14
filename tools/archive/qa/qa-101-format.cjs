/*
 * The format module is pure, so it is tested directly in Node rather
 * than through the browser. Each case is a real thing a user can
 * hand us: a good file, an old file, a future file, a wrong file,
 * and a damaged one.
 */
global.window = {};
require("./js/engineering-drawing/document-file.js");
const f = global.window.enggDocumentFile;

let pass = 0;
let fail = 0;

const check = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    pass += 1;
    console.log(`  ok   ${name}`);
  } else {
    fail += 1;
    console.log(
      `  FAIL ${name}\n       expected ${JSON.stringify(expected)}` +
        `\n       actual   ${JSON.stringify(actual)}`,
    );
  }
};

const body = { objects: [{ id: "a", type: "beam" }], units: "mm" };

console.log("\nEnvelopes");
const doc = f.createDocument(body);
check("format marker", doc.format, "enggdraw");
check("version is current", doc.version, f.CURRENT_VERSION);
check("carries the document", doc.document, body);
check("records a save time", typeof doc.savedAt, "string");

console.log("\nRound trip");
check("good file reads back", f.readDocument(doc).document, body);
check("no migration needed", f.readDocument(doc).migratedFrom, 1);

console.log("\nRefusals");
check(
  "a file from the future is refused",
  f.readDocument({ format: "enggdraw", version: 99, document: body }).failure,
  "from-the-future",
);
check(
  "and says so in the detail",
  f
    .readDocument({ format: "enggdraw", version: 99, document: body })
    .detail.includes("newer version"),
  true,
);
check(
  "a non-EnggDraw file is refused",
  f.readDocument({ format: "something-else", version: 1, document: body })
    .failure,
  "wrong-format",
);
check(
  "a file with no version is refused",
  f.readDocument({ format: "enggdraw", document: body }).failure,
  "no-document",
);
check("a non-object is refused", f.readDocument(null).failure, "not-json");
check("a string is refused", f.readDocument("hello").failure, "not-json");

console.log("\nThe earliest draft");
check(
  "an 'engg-drawing' file is still recognised",
  f.readDocument({
    format: "engg-drawing",
    version: 1,
    data: body,
  }).failure,
  "no-document",
);

console.log("\nFile names");
check("adds the extension", f.withExtension("Report"), "Report.enggdraw");
check(
  "does not double it",
  f.withExtension("Report.enggdraw"),
  "Report.enggdraw",
);
check(
  "is case-insensitive about it",
  f.withExtension("Report.EnggDraw"),
  "Report.EnggDraw",
);
check("falls back", f.withExtension(""), "drawing.enggdraw");
check("falls back on blank", f.withExtension("   "), "drawing.enggdraw");

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);

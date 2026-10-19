/*
 * Every field written onto `interaction` anywhere in the app, compared
 * against the fields clearInteraction resets.
 *
 * The analysisPlacement bug was found by reading one file. This finds the
 * whole CLASS: any field a tool writes, that clearInteraction does not
 * reset, survives the operation that was supposed to end it.
 */
const fs = require("fs");
const path = require("path");
const { locate, modulePath, sourceDir } = require("./helpers/source-path.cjs");

const root = path.join(__dirname, "..");

const files = fs
  .readdirSync(root)
  .filter((f) => f.endsWith(".js"))
  .map((f) => path.join(root, f));

const written = new Map();

for (const file of files) {
  const text = fs.readFileSync(file, "utf8");

  /*
   * Both spellings: the long form and the short `i.` alias several tool
   * handlers take. Missing the alias would hide every field a tool sets
   * through it, which is most of them.
   */
  const re =
    /(?:drawingState\.interaction|interaction|\bi)\.([a-zA-Z_]\w*)\s*=(?!=)/g;

  let m;

  while ((m = re.exec(text))) {
    const field = m[1];

    if (!written.has(field)) {
      written.set(field, new Set());
    }

    written.get(field).add(path.basename(file));
  }
}

/*
 * The fields clearInteraction resets.
 *
 * The function body is delimited by counting braces from its opening one,
 * not by searching for the next line that looks like a closing brace -
 * this file has nested braces at the same indent, and slicing to the first
 * "\n    }" ran the scan on into the functions AFTER it. That reported 56
 * cleared fields when the function really resets 26, and the first run
 * therefore could not be trusted.
 */
const stateText = fs.readFileSync(
  locate("drawing-state.js"),
  "utf8",
);

const clearStart = stateText.indexOf("function clearInteraction");

if (clearStart < 0) {
  console.log("clearInteraction not found");
  process.exit(1);
}

const openBrace = stateText.indexOf("{", clearStart);

let depth = 0;
let clearBody = "";

for (let i = openBrace; i < stateText.length; i++) {
  const ch = stateText[i];

  if (ch === "{") {
    depth++;
  } else if (ch === "}") {
    depth--;

    if (depth === 0) {
      clearBody = stateText.slice(openBrace, i + 1);
      break;
    }
  }
}

const cleared = new Set();

const clearRe = /state\.interaction\.([a-zA-Z_]\w*)\s*=/g;

let cm;

while ((cm = clearRe.exec(clearBody))) {
  cleared.add(cm[1]);
}

/*
 * PROOF THE SCANNER IS WORTH KEEPING: remove analysisPlacement from the
 * cleared set and confirm it is reported as a leak. A scanner that cannot
 * reproduce the bug it was written for is a scanner that reports nothing.
 */
const clearedWithoutFix = new Set(cleared);

clearedWithoutFix.delete("analysisPlacement");

const catchesKnownBug =
  [...written.keys()].some(
    (f) =>
      f === "analysisPlacement" &&
      !clearedWithoutFix.has(f),
  );

console.log(
  `\n  scanner reproduces the known bug: ${
    catchesKnownBug ? "yes" : "NO - the scanner is useless"
  }\n`,
);

console.log(
  `\n  interaction fields written: ${written.size}, cleared: ${cleared.size}\n`,
);

const leaks = [...written.keys()]
  .filter((f) => !cleared.has(f))
  .sort();

console.log(`\n  WRITTEN BUT NEVER CLEARED (${leaks.length}):\n`);

for (const field of leaks) {
  console.log(`    ${field.padEnd(26)} ${[...written.get(field)].join(", ")}`);
}

/*
 * THE ASSERTION.
 *
 * Every field a tool writes onto the interaction must be reset by the one
 * function that ends an interaction. A field that is not survives into the
 * next tool, and reads as that tool's stale state rather than as a leak -
 * which is how the analysis placement preview came to be drawn, in the
 * diagram's own green, permanently.
 *
 * FIELDS THAT ARE GENUINELY PERSISTENT MAY BE ALLOWED, but they have to be
 * named here deliberately. An unlisted one is a bug.
 */
const ALLOWED_PERSISTENT = [];

const unexpected = leaks.filter(
  (f) => !ALLOWED_PERSISTENT.includes(f),
);

console.log("");

if (unexpected.length) {
  console.log(
    `  FAIL ${unexpected.length} interaction field(s) survive an operation:\n`,
  );

  for (const field of unexpected) {
    console.log(
      `       ${field} - written in ${[...written.get(field)].join(", ")}`,
    );
  }

  process.exitCode = 1;
} else {
  console.log("  ok   every interaction field is reset when an operation ends");
}

console.log("");

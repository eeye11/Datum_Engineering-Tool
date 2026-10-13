/*
 * ========================================================
 * THE ANNOTATE TOOLSET HAS THE STATICS SHAPE
 * ========================================================
 *
 * The requirement is structural and specific: Annotate is organised the way
 * Statics is - a short list of CATEGORY headings, each with its commands
 * listed DIRECTLY underneath - and the categories do not hide commands.
 *
 * That is easy to undo by accident: a `submenu: true` added to one entry
 * turns that command into a parent that has to be clicked before it can be
 * used, and nothing would throw. So the shape is asserted here.
 */

const fs = require("fs");

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

const source = fs.readFileSync(modulePath("tools.js"), "utf8");

/* The annotateToolGroups block, from its declaration to the closing `];`. */
const start = source.indexOf("export const annotateToolGroups");
const end = source.indexOf("\n];", start);
const groups = source.slice(start, end + 3);

console.log("\n  two categories, exactly like Statics\n");

check(
  "the Annotate toolset is declared",
  start >= 0 && end > start,
  "annotateToolGroups was not found",
);

check(
  "it declares the five functional categories, in order",
  (() => {
    const labels = [...groups.matchAll(/^\t\tlabel:\s*"([^"]+)"/gm)].map(
      (m) => m[1],
    );

    return (
      labels.join(" | ") ===
      "Selection | Dimensions | Text | Leaders | Symbols | Tables"
    );
  })(),
  "Annotate is organised by WHAT AN ANNOTATION DOES, in a fixed order",
);

check(
  "Select is the FIRST category",
  /label:\s*"Selection"/.test(groups) &&
    groups.indexOf('"Selection"') < groups.indexOf('"Dimensions"'),
  "selection always comes first",
);

console.log("\n  every command is listed DIRECTLY under its category\n");

[
  "variable-dimension",
  "smart-dimension",
  "note",
  "label",
  "leader",
  "callout",
  "symbol",
  "table",
].forEach((id) => {
  check(
    `"${id}" is a command in the toolset`,
    new RegExp(`id:\\s*"${id}"`).test(groups),
    `${id} was not found in the Annotate groups`,
  );
});

/*
 * THE V1 EXCLUSIONS. The standalone Arrow and Tolerance TOOLS are not part of
 * V1 and are not offered in the Annotate menu. The KINDS remain in the model so
 * saved drawings still open - see the note in tools.js.
 */
["arrow", "tolerance"].forEach((id) => {
  check(
    `the standalone "${id}" tool is NOT offered in V1`,
    !new RegExp(`id:\\s*"${id}"`).test(groups),
    `${id} is still a command in the Annotate toolset`,
  );
});

check(
  "Select is a command too",
  /id:\s*"select"/.test(groups),
);

console.log("\n  NO COMMAND IS HIDDEN BEHIND A SUBMENU\n");

check(
  "not one Annotate entry opens a submenu",
  !/submenu:\s*true/.test(groups),
  "a submenu is a navigation layer - the command must be visible and clickable",
);

check(
  "every tool is declared inside a category's `tools` list, not nested",
  !/tools:\s*\[\s*\{[^}]*tools:/.test(groups),
  "a tool holding its own `tools` list would be a third level",
);

check(
  "the hierarchy stops at category -> tool",
  (groups.match(/tools:\s*\[/g) || []).length === 6,
  "one `tools` list per category, and none inside a tool",
);

console.log("\n  the tool ids ARE the feature kinds, derived not restated\n");

{
  const creation = fs.readFileSync(
    modulePath("annotate-creation.js"),
    "utf8",
  );

  /*
   * The map is BUILT FROM the model's own kind table rather than listing the
   * eight names a second time, so a kind added to the model cannot end up
   * with no tool. The check is that derivation, not a list of names.
   */
  check(
    "the tool map is derived from the model's kind table",
    /ANNOTATE_TOOL_KINDS\s*=\s*Object\.fromEntries\([\s\S]{0,200}ANNOTATE_KINDS/.test(
      creation,
    ),
    "a restated list would be a second place to keep in step",
  );

  check(
    "and it maps each kind to itself, so tool id === feature kind",
    /\.map\(\(kind\)\s*=>\s*\[kind,\s*kind\]\)/.test(creation),
  );
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);

if (fail) {
  process.exitCode = 1;
}

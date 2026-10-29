/*
 * ========================================================
 * COMMAND SEARCH FINDS COMMANDS BY THE WORDS PEOPLE TYPE
 * ========================================================
 *
 * The requirement names four searches that must work:
 *
 *   "Trim"          finds the Trim drawing tool
 *   "Print"         finds File > Print
 *   "Dark Mode"     finds the Application Theme setting
 *   "Fit to Screen" finds the View command
 *
 * THREE OF THOSE ARE THE COMMAND'S OWN NAME, and the fourth is not: the theme
 * lives inside Drawing Settings, so nothing on a menu says "dark mode". A search
 * that only read menu labels could not find it - which is the defect these
 * checks exist to prevent.
 *
 * AND EVERY RESULT MUST RUN SOMETHING. A result built from a command that has no
 * implementation would be a result that does nothing, which teaches the student
 * that the search cannot be trusted.
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

const dom = new JSDOM(
  `<!doctype html><html><body>
     <div class="drawing-canvas"></div>
     <div id="drawingProperties"></div>
     <div id="drawingToolMessage"></div>
     <div id="drawingCoordinates"></div>
     <div id="drawingZoomValue"></div>
     <button id="drawingUndo"></button>
     <button id="drawingRedo"></button>
     <button id="drawingGridToggle" aria-pressed="true"></button>
     <button id="drawingSnapToggle" aria-pressed="true"></button>
     <button id="drawingDimensionsToggle" aria-pressed="true"></button>
     <button id="drawingMagnitudesToggle" aria-pressed="true"></button>
     <div id="drawingToolHeading"></div>
     <div id="drawingToolList"></div>
     <div id="drawingFeaturesBack"></div>
   </body></html>`,
  { pretendToBeVisual: true, url: "https://datum.test/" },
);

global.window = dom.window;
global.document = dom.window.document;
global.navigator = dom.window.navigator;
global.Element = dom.window.Element;

[
  "measurement-core.js",
  "quantities.js",
  "dimension-model.js",
  "annotation-model.js",
  "diagram-equations.js",
  "load-profile.js",
  "body-frames.js",
  "feature-geometry.js",
  "drawing-state.js",
  "renderer.js",
].forEach((name) => require(modulePath(name)));

const search = require(modulePath("command-search.js"));

const labels = (query) => search.searchCommands(query).map((r) => r.label);

console.log("\n  the four searches the specification names\n");

check(
  "Trim finds the Trim tool",
  labels("Trim").some((l) => /Trim/.test(l)),
  labels("Trim").join(" | "),
);

check(
  "Print finds File > Print",
  labels("Print").some((l) => /Print/.test(l)),
  labels("Print").join(" | "),
);

check(
  "Fit to Screen finds the View command",
  labels("Fit to Screen").some((l) => /Fit/.test(l)),
  labels("Fit to Screen").join(" | "),
);

check(
  "Dark Mode finds the theme setting",
  labels("Dark Mode").some((l) => /Settings|Theme|Appearance/.test(l)),
  labels("Dark Mode").join(" | ") || "(no results)",
);

console.log("\n  and the aliases reach the settings people look for\n");

for (const [query, expected] of [
  ["dark", /Settings/],
  ["theme", /Settings/],
  ["light mode", /Settings/],
  ["units", /Settings/],
  ["snapping", /Snapping|Settings/],
  ["keyboard", /Shortcuts/],
  ["shortcuts", /Shortcuts/],
  ["measure", /Measure|Inspection/],
  ["inspect", /Inspect|Inspection/],
]) {
  const found = labels(query).some((l) => expected.test(l));

  check(
    `"${query}" reaches ${expected.source}`,
    found,
    labels(query).join(" | "),
  );
}

console.log("\n  a result is a REAL command, not a label\n");

{
  const results = search.searchCommands("save");

  check("there is a Save result", results.length > 0);

  check(
    "and it carries a function to run",
    results.every((r) => typeof r.run === "function"),
    "a result that cannot run is a result that does nothing",
  );

  check(
    "and says which menu it lives in",
    results.every((r) => typeof r.menu === "string" && r.menu.length > 0),
  );
}

console.log("\n  one row per command\n");

{
  /*
   * An alias and a label match can both point at the same command. Two
   * identical results would look like a bug.
   */
  const ids = search.searchCommands("drawing").map((r) => r.id);

  check(
    "the same command is not listed twice",
    new Set(ids).size === ids.length,
    ids.join(", "),
  );
}

/* ========================================================
 * THE WHOLE APPLICATION IS SEARCHABLE
 * ========================================================
 *
 * A student does not know which section holds a tool, so these are the
 * searches that must work without knowing the layout: a tool behind a dropdown,
 * a section by name, a command by what it does, a panel by what it shows.
 *
 * Each expectation names WHAT the result must be - a tool, a section, a
 * command, a panel - because a result that says the right word but cannot do
 * the right thing is not a result.
 */
console.log("\n  every kind of thing is findable, by the words people type\n");

const find = (query) => search.searchCommands(query, 20);

for (const [query, type, pattern, why] of [
  ["pipe", "tool", /Pipe \/ Duct/, "the Pipe / Duct tool"],
  ["pipes", "tool", /Pipe \/ Duct/, "a plural typing of the same"],
  ["elbow", "tool", /Elbow/, "the Elbow tool"],
  ["Fluid Level", "tool", /Fluid Level/, "the Fluid Level tool"],
  ["flow arrow", "tool", /Flow Arrow/, "the Flow Arrow tool"],
  ["flow direction", "tool", /Flow Direction/, "the Flow Direction Diagram"],
  ["pump", "tool", /Pump/, "the Pump tool"],
  ["valve", "tool", /Valve/, "the Valve tool"],
  ["flow meter", "tool", /Flow Meter/, "the Flow Meter tool"],
  ["junction", "tool", /Junction/, "the Junction tool"],
  ["reference point", "tool", /Reference Point/, "the Reference Point tool"],
  ["reference line", "tool", /Reference Line/, "the Reference Line tool"],
  ["coordinate system", "tool", /Coordinate System/, "the Coordinate System"],
  ["sfd", "tool", /Shear Force/, "Shear Force by its abbreviation"],
  ["udl", "tool", /Distributed Load/, "a distributed load by its nickname"],
  ["3-point arc", "tool", /3-Point Arc/, "an Arc construction method"],
  ["fluids", "section", /Fluids/, "the Fluids category"],
  ["flow paths", "section", /Flow Paths/, "the Flow Paths group"],
  ["statics", "section", /Statics/, "the Statics category"],
  ["thermodynamics", "section", /Thermodynamics/, "the Thermodynamics category"],
  ["zoom", "command", /Zoom/, "the zoom commands"],
  ["hide", "command", /(Hide|Show)/, "a visibility command"],
  ["rotate", "command", /Rotate/, "the Rotate command"],
  ["select all", "command", /Select All/, "Select All"],
  ["undo", "command", /Undo/, "Undo"],
  ["open source", "panel", /Source/, "the Source tab"],
  ["objects", "panel", /Objects/, "the Objects tab"],
  ["sheet", "view", /Sheets|Sheet/, "the sheet tabs"],
  ["dark mode", "command", /Settings/, "the theme setting"],
  ["change pipe width", "tool", /Pipe \/ Duct/, "a pipe's width, through its tool"],
  ["show hidden object", "command", /(Hide|Show)/, "a visibility command"],
]) {
  const hit = find(query).find(
    (result) => result.type === type && pattern.test(result.label),
  );

  check(
    `"${query}" finds ${why}`,
    Boolean(hit),
    find(query)
      .slice(0, 5)
      .map((result) => `[${result.type}] ${result.label}`)
      .join(" | ") || "(no results)",
  );
}

console.log("\n  a result says where it lives\n");

{
  const elbow = find("elbow").find((result) => result.type === "tool");

  check(
    "the Elbow tool names its section",
    /Fluids/.test(elbow.location) && /Flow Paths/.test(elbow.location),
    elbow.location,
  );

  const fluids = find("fluids").find((result) => result.type === "section");

  check("and the Fluids category is a Section result, not a Tool", fluids.type === "section");
}

console.log("\n  forgiving typing, without losing precision\n");

for (const [query, expected, why] of [
  ["PIPE", /Pipe \/ Duct/, "upper case"],
  ["Pipe/Duct", /Pipe \/ Duct/, "punctuation"],
  ["pipe-duct", /Pipe \/ Duct/, "hyphens"],
  ["  elbow  ", /Elbow/, "stray spaces"],
  ["flud", /Fluids|Flow/, "a typo"],
  ["colur", /Features|Colour|Color|Line/, "the American/misspelt spelling of colour"],
  ["color", /Features|Colour|Color|Line/, "the American spelling"],
  ["refrence point", /Reference Point/, "a misspelt reference"],
  ["dimention", /Dimension/, "a misspelt dimension"],
]) {
  check(
    `"${query}" is tolerated (${why})`,
    find(query).some((result) => expected.test(result.label)),
    find(query)
      .slice(0, 4)
      .map((result) => `${result.label}`)
      .join(" | "),
  );
}

console.log("\n  and the best match comes first\n");

{
  const print = search.searchCommands("print");

  check(
    "Print is the first result for \"print\"",
    print[0]?.label === "Print",
    print.slice(0, 3).map((result) => result.label).join(" | "),
  );

  const save = search.searchCommands("save");

  check(
    "Save is offered before Save As",
    save.findIndex((result) => result.label === "Save") <
      save.findIndex((result) => result.label === "Save As"),
    save.map((result) => result.label).join(" | "),
  );

  const elbow = search.searchCommands("elbow");

  check(
    "and the Elbow tool is offered before the section that holds it",
    elbow[0]?.label === "Elbow" && elbow[0]?.type === "tool",
    elbow.slice(0, 3).map((result) => `[${result.type}] ${result.label}`).join(" | "),
  );

  const fluids = search.searchCommands("fluids");

  check(
    "and the Fluids category leads its own tools",
    fluids[0]?.label === "Fluids" && fluids[0]?.type === "section",
    fluids.slice(0, 3).map((result) => `[${result.type}] ${result.label}`).join(" | "),
  );
}

console.log("\n  and a query that matches nothing returns nothing\n");

{
  check(
    "an empty query returns no results",
    search.searchCommands("").length === 0,
  );

  check(
    "and a nonsense query returns no results",
    search.searchCommands("zzzzqqq").length === 0,
  );
}

console.log("\n  a context-dependent command says what it needs\n");

{
  const copy = find("copy").find((result) => result.type === "command" && /^Copy$/.test(result.label));

  check(
    "Copy is findable with nothing selected",
    Boolean(copy),
    "a command that only exists with a selection must still be discoverable",
  );

  check(
    "and it says it needs a selection rather than pretending it can run",
    copy.disabled === true && /select/i.test(copy.reason),
    `disabled: ${copy.disabled}, reason: ${copy.reason}`,
  );
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);

if (fail) {
  process.exitCode = 1;
}

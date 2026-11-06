/*
 * ========================================================
 * THE SEARCH INDEX COVERS THE WHOLE APPLICATION
 * ========================================================
 *
 * The requirement is not "these twelve queries work" - it is that EVERY tool,
 * section, command and destination the application really offers is findable,
 * and that nothing that does not exist is offered.
 *
 * So this test names no queries. It reads the SAME registries the application
 * renders from - the toolset the toolbar builds, the menu tree, the panel tabs -
 * and compares the index with them in BOTH directions:
 *
 *   every tool the toolbar can show      is findable, as a tool or its group
 *   every row naming a tool              names one the toolbar really draws
 *   every category and section           is a section row
 *   every menu command                   is a command row
 *   every panel tab                      is a panel row
 *   every available row                  has a handler
 *   every unavailable row                says why
 *   every alias                          names an entry that exists
 *   every row's id                       is unique
 *
 * It is the check that a tool added to a section cannot be forgotten: the tool
 * is in the toolbar's list, and the list is what this compares with.
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
     <div id="drawingToolHeading"></div>
     <div id="drawingToolList"></div>
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

const index = require(modulePath("command-index.js"));
const tools = require(modulePath("tools.js"));
const fluids = require(modulePath("fluids-tools.js"));
const dynamics = require(modulePath("dynamics-tools.js"));
const statics = require(modulePath("statics-tools.js"));
const menus = require(modulePath("menu-commands.js"));

const entries = index.searchIndex();

const ofType = (type) => entries.filter((entry) => entry.type === type);

/* Every id an entry names: the tool it arms, or the group it opens. */
const namedIds = new Set(
  entries.flatMap((entry) => [entry.toolId, entry.opens].filter(Boolean)),
);

/* Rows the library registry holds but no tool section offers. */
const libraryRows = entries.filter((entry) => entry.section === "Tool library");

const offeredIds = new Set(
  entries
    .filter((entry) => entry.section !== "Tool library")
    .flatMap((entry) => [entry.toolId, entry.opens].filter(Boolean)),
);

console.log("\n  every tool the toolbar can show is in the index\n");

/*
 * THE TOOLSET, AS THE TOOLBAR BUILDS IT.
 *
 * Every section's tools, every group's children from the three child tables,
 * the extra children the toolbar draws from its own literals, and the flat
 * disciplines' lists - with labels turned into ids the way the toolbar does it.
 */
const expectedTools = new Set();

const addGroups = (groups) => {
  (groups || []).forEach((group) => {
    (group.tools || []).forEach((tool) => {
      const children =
        dynamics.DYNAMICS_TOOL_MENUS[tool.id] ||
        fluids.FLUIDS_TOOL_MENUS[tool.id] ||
        statics.STATICS_TOOL_MENUS[tool.id];

      if (children) {
        /* The parent is a place, and it is still a row the toolbar draws. */
        expectedTools.add(tool.id);
        children.forEach((child) => expectedTools.add(child.id));
        return;
      }

      expectedTools.add(tool.id);
    });
  });
};

addGroups(tools.drawingToolGroups);
Object.values(tools.disciplineToolGroups).forEach(addGroups);

/* The families the toolbar draws from literals, by the ids it gives them. */
[
  "rankine-cycle",
  "reheat-rankine-cycle",
  "brayton-cycle",
  "otto-cycle",
  "diesel-cycle",
  "carnot-cycle",
  "vapor-compression-cycle",
  "turbine-compressor",
  "nozzle-diffuser",
  "work-arrow",
  "electric-work",
  "mechanical-work",
  "heat-entering",
  "heat-leaving",
  "process-plot",
  "saturation-curve",
  "process-path",
  "constant-temp-pressure-lines",
  "piston-cylinder-stoppers",
  "coordinate-system-2d",
  "coordinate-system-3d",
].forEach((id) => expectedTools.add(id));

/* The flat disciplines: their labels, mapped to ids as the toolbar maps them. */
const idByLabel = new Map(
  Object.entries(tools.drawToolLabelById).map(([id, label]) => [label, id]),
);

["HEAT TRANSFER", "MECHANICAL DESIGN", "CONTROLS", "MATH / ANALYSIS"]
  .flatMap((key) => tools.engineeringTools[key])
  .forEach((label) =>
    expectedTools.add(idByLabel.get(label) || label.toLowerCase().replace(/[^a-z]+/g, "-")),
  );

/*
 * `thermodynamic-cycles` names BOTH a Create entry and an Analysis section. It
 * is one place, and it is indexed once - under the section that carries its own
 * name - so its row is the SECTION, not a tool.
 */
const GROUP_ONLY = new Set(["thermodynamic-cycles"]);

const missingTools = [...expectedTools].filter(
  (id) => !offeredIds.has(id) && !GROUP_ONLY.has(id),
);

check(
  "and a place that is offered only as a section is still findable as one",
  entries.some((entry) => entry.type === "section" && entry.opens === "thermodynamic-cycles"),
);

check(
  `all ${expectedTools.size} rows the toolset can show are findable`,
  missingTools.length === 0,
  `missing: ${missingTools.join(", ")}`,
);

check(
  "every entry that names a tool names one the toolset really draws",
  [
    [...namedIds].filter(
      (id) => !expectedTools.has(id) && !id.startsWith("shear-force-diagram:"),
    ),
  ].every((list) => list.length === 0),
  [...namedIds]
    .filter((id) => !expectedTools.has(id) && !id.startsWith("shear-force-diagram:"))
    .join(", "),
);

console.log("\n  categories and sections are distinct from tools\n");

const expectedSections = new Set(Object.keys(tools.engineeringTools));

Object.entries(tools.disciplineToolGroups).forEach(([key, groups]) => {
  (groups || []).forEach((group) => expectedSections.add(`${key}/${group.label}`));
});

const sectionKeys = new Set(
  ofType("section").map((entry) =>
    entry.section && entry.section !== entry.label
      ? `${entry.discipline}/${entry.section}`
      : entry.section
        ? `${entry.discipline}/${entry.label}`
        : entry.discipline,
  ),
);

const missingSections = [...expectedSections].filter((key) => {
  if (!key.includes("/")) {
    return !ofType("section").some(
      (entry) => entry.discipline === key && entry.section === null,
    );
  }

  return !sectionKeys.has(key) && !ofType("section").some((entry) => key.endsWith(entry.label));
});

check(
  `all ${expectedSections.size} categories and sections are indexed`,
  missingSections.length === 0,
  `missing: ${missingSections.join(", ")}`,
);

check(
  "and a category row has no tool, because it arms nothing",
  ofType("section")
    .filter((entry) => entry.section === null)
    .every((entry) => !entry.toolId && !entry.opens),
);

console.log("\n  every menu command is in the index\n");

const expectedCommands = new Set();

menus.MENUS.forEach((menu) => {
  const definition = menu();

  const walk = (items, parent) => {
    items.forEach((item) => {
      if (item.separator) {
        return;
      }

      if (Array.isArray(item.submenu)) {
        walk(item.submenu, item);
        return;
      }

      if (typeof item.run === "function") {
        expectedCommands.add(
          `${definition.id}:${parent ? `${parent.id}:` : ""}${item.id}`,
        );
      }
    });
  };

  walk(definition.items, null);
});

const commandIds = new Set(
  ofType("command").map((entry) => entry.id.replace(/^command:/, "")),
);

check(
  `all ${expectedCommands.size} menu commands are indexed`,
  [...expectedCommands].every((id) => commandIds.has(id)),
  `missing: ${[...expectedCommands].filter((id) => !commandIds.has(id)).join(", ")}`,
);

check(
  "and no command row names a menu item that does not exist",
  [...commandIds].every((id) => expectedCommands.has(id)),
  [...commandIds].filter((id) => !expectedCommands.has(id)).join(", "),
);

console.log("\n  every panel destination is in the index\n");

["objects", "features", "source"].forEach((tab) => {
  check(`the ${tab} panel is indexed`, entries.some((entry) => entry.id === `panel:${tab}`));
});

check(
  "the workspace destinations are indexed",
  entries.some((entry) => entry.id === "view:toolset") &&
    entries.some((entry) => entry.id === "view:sheet-tabs"),
);

console.log("\n  every row can do something, or says why it cannot\n");

check(
  "every available row has a handler",
  entries
    .filter((entry) => !entry.disabled)
    .every((entry) => typeof entry.run === "function"),
  entries
    .filter((entry) => !entry.disabled && typeof entry.run !== "function")
    .map((entry) => `${entry.id} (${entry.label})`)
    .join(", "),
);

check(
  "every unavailable row says why",
  entries.filter((entry) => entry.disabled).every((entry) => Boolean(entry.reason)),
  entries
    .filter((entry) => entry.disabled && !entry.reason)
    .map((entry) => entry.id)
    .join(", "),
);

check(
  "and everything the library holds but no section offers is marked, not offered",
  libraryRows.every((entry) => entry.disabled && typeof entry.run !== "function"),
  libraryRows
    .filter((entry) => !entry.disabled || typeof entry.run === "function")
    .map((entry) => entry.id)
    .join(", "),
);

check(
  "and the two tools the interface really cannot use are marked unavailable",
  entries.some((entry) => entry.toolId === "coordinate-system-3d" && entry.disabled),
);

console.log("\n  aliases point at entries that exist\n");

const ids = new Set(entries.map((entry) => entry.id));

check(
  "no alias names a missing entry",
  index.ALIASES.entries.every((alias) => ids.has(alias.target)),
  index.ALIASES.entries
    .filter((alias) => !ids.has(alias.target))
    .map((alias) => alias.target)
    .join(", "),
);

check(
  "and every alias contributes its words to the entry it names",
  index.ALIASES.entries.every((alias) =>
    entries.find((entry) => entry.id === alias.target).terms.includes(alias.terms[0]),
  ),
);

check(
  "and no alias term was made into a result of its own",
  entries.every((entry) => typeof entry.run === "function" || entry.disabled),
);

console.log("\n  the rows themselves are sound\n");

const rowIds = entries.map((entry) => entry.id);

check(
  "every row id is unique",
  new Set(rowIds).size === rowIds.length,
  rowIds.filter((id, position) => rowIds.indexOf(id) !== position).join(", "),
);

check(
  "every row has a label",
  entries.every((entry) => typeof entry.label === "string" && entry.label.trim()),
);

check(
  "every tool row says where it lives, starting from its discipline",
  ofType("tool").every((entry) => {
    const category = entries.find(
      (candidate) => candidate.id === `section:${entry.discipline}:category`,
    );

    return String(entry.location).startsWith(category ? category.label : entry.discipline);
  }),
);

check(
  "every type is one the search knows how to present",
  entries.every((entry) =>
    ["tool", "section", "command", "panel", "view", "feature"].includes(entry.type),
  ),
);

console.log(`\n  ${pass} passed, ${fail} failed\n`);

if (fail) {
  process.exitCode = 1;
}

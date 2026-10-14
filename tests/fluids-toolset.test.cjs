/* eslint-disable no-console */
/*
 * ========================================================
 * THE FLUIDS TOOLSET: SIX SUBCATEGORIES, SEVENTEEN ENTRIES
 * ========================================================
 *
 * The requirement is structural and specific: Fluids is organised the way
 * Statics and Annotate are - a short list of CATEGORY headings, each with its
 * commands listed DIRECTLY underneath - and the categories do not hide
 * commands.
 *
 * That is easy to undo by accident: a `submenu: true` added to one entry turns
 * that command into a parent that has to be clicked before it can be used, and
 * nothing would throw. So the shape is asserted here, against the registry the
 * toolbar actually reads.
 *
 * The tools are ALSO checked to be bound to an existing DAETUM system - that is
 * the other half of the requirement ("reuse existing selection, drawing,
 * dimensioning and annotation systems"). An entry with no capability would be
 * a button with nothing behind it.
 */

const { loadModule, modulePath } = require("./helpers/source-path.cjs");

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

const fluidsModule = loadModule("fluids-tools.js");
const fluids = fluidsModule.default || fluidsModule;

const groups = fluids.fluidsToolGroups;

/* ============================================================
 * 1. THE SIX SUBCATEGORIES, IN THE REQUIRED ORDER
 * ============================================================ */

console.log("\n  six subcategories, in the order the requirement gives\n");

const expectedCategories = [
  "Selection",
  "Flow Paths",
  "Equipment",
  "Flow Representation",
  "Measurements",
  "Fluid Annotations",
];

check(
  "the Fluids toolset declares six categories",
  groups.length === 6,
  `found ${groups.length}`,
);

check(
  "the categories are exactly the six the requirement names, in order",
  groups.map((group) => group.label).join(" | ") ===
    expectedCategories.join(" | "),
  groups.map((group) => group.label).join(" | "),
);

check(
  "Select is the FIRST category",
  groups[0].label === "Selection" &&
    groups[0].tools.some((tool) => tool.id === "select"),
  "selection always comes first, exactly as it does in Statics and Annotate",
);

/* ============================================================
 * 2. EVERY TOOL, IN ITS CORRECT SUBCATEGORY
 * ============================================================ */

console.log("\n  every tool is in the subcategory the requirement names\n");

const expectedTools = {
  Selection: ["select"],
  "Flow Paths": [
    "pipe-duct",
    "elbow",
    "junction",
    "reducer-expander",
    "reservoir-tank",
  ],
  Equipment: ["pump", "valve", "flow-meter"],
  "Flow Representation": ["flow-arrow", "fluid-level"],
  Measurements: ["pressure-tap", "pipe-diameter", "section-plane"],
  "Fluid Annotations": [
    "fluid-property-label",
    "flow-rate-label",
    "elevation-marker",
  ],
};

Object.entries(expectedTools).forEach(([category, ids]) => {
  const group = groups.find((entry) => entry.label === category);

  check(
    `"${category}" holds its tools, in order`,
    Boolean(group) &&
      group.tools.map((tool) => tool.id).join(" | ") === ids.join(" | "),
    group ? group.tools.map((tool) => tool.id).join(" | ") : "category missing",
  );
});

/* ============================================================
 * 3. SEVENTEEN ENTRIES, NO MORE AND NO FEWER
 * ============================================================ */

console.log("\n  the seventeen listed entries\n");

const allIds = groups.flatMap((group) => group.tools.map((tool) => tool.id));

check(
  "there are exactly seventeen entries",
  allIds.length === 17,
  `found ${allIds.length}: ${allIds.join(", ")}`,
);

check(
  "no tool id is declared twice",
  new Set(allIds).size === allIds.length,
  allIds.join(", "),
);

check(
  "the flat registry holds one entry per tool",
  Object.keys(fluids.FLUIDS_TOOLS).length === 17,
  Object.keys(fluids.FLUIDS_TOOLS).join(", "),
);

/* ============================================================
 * 4. THE V1 EXCLUSIONS: NO INLET / OUTLET MARKERS
 * ============================================================ */

console.log("\n  no inlet or outlet marker tools\n");

["inlet", "outlet", "inlet-marker", "outlet-marker"].forEach((id) => {
  check(
    `no "${id}" tool is offered`,
    !allIds.includes(id),
    "flow direction is shown with the Flow Arrow, not an inlet/outlet marker",
  );
});

/* ============================================================
 * 5. NO COMMAND IS HIDDEN BEHIND A SUBMENU
 * ============================================================ */

console.log("\n  NO COMMAND IS HIDDEN BEHIND A SUBMENU\n");

check(
  "not one Fluids entry opens a submenu",
  !groups.some((group) =>
    group.tools.some((tool) => tool.submenu === true),
  ),
  "a submenu is a navigation layer - the command must be visible and clickable",
);

check(
  "the hierarchy stops at category -> tool",
  !groups.some((group) =>
    group.tools.some((tool) => Array.isArray(tool.tools)),
  ),
  "a tool holding its own `tools` list would be a third level",
);

/* ============================================================
 * 6. EVERY ENTRY IS BOUND TO AN EXISTING SYSTEM
 * ============================================================ */

console.log("\n  every entry reuses an existing DAETUM system\n");

const capabilities = fluids.FLUIDS_CAPABILITIES;
const validCapabilities = Object.values(capabilities);

check(
  "the capability table names the six shared systems",
  validCapabilities.join(" | ") ===
    "select | shape | route | dimension | annotate | planned",
  validCapabilities.join(" | "),
);

const unbounded = groups
  .flatMap((group) => group.tools)
  .filter((tool) => !validCapabilities.includes(tool.capability));

check(
  "no entry is left without a capability",
  unbounded.length === 0,
  unbounded.map((tool) => tool.id).join(", ") ||
    "an unbound entry is a button with nothing behind it",
);

/* A shape entry must name the primitive it draws with. */
const shapeEntries = groups
  .flatMap((group) => group.tools)
  .filter((tool) => tool.capability === capabilities.SHAPE);

check(
  "every shape entry names the geometry tool it draws with",
  shapeEntries.length > 0 &&
    shapeEntries.every((tool) =>
      ["line", "rectangle", "circle", "point"].includes(tool.geometryTool),
    ),
  shapeEntries.map((tool) => `${tool.id}:${tool.geometryTool}`).join(", "),
);

/* An annotate entry must name a real Annotate kind. */
const annotateModule = loadModule("annotate-model.js");
const annotate = annotateModule.default || annotateModule;

const annotateEntries = groups
  .flatMap((group) => group.tools)
  .filter((tool) => tool.capability === capabilities.ANNOTATE);

check(
  "every annotate entry names a real Annotate kind",
  annotateEntries.length > 0 &&
    annotateEntries.every((tool) =>
      Boolean(annotate.ANNOTATE_KINDS[tool.annotateKind]),
    ),
  annotateEntries
    .map((tool) => `${tool.id}:${tool.annotateKind}`)
    .join(", "),
);

/* ============================================================
 * 7. THE SECTION IS MODULAR: BEHAVIOUR IS ONE FIELD
 * ============================================================ */

console.log("\n  the section is modular\n");

check(
  "the registry is built FROM the groups, not restated",
  /FLUIDS_TOOLS\s*=\s*Object\.freeze\([\s\S]{0,200}fluidsToolGroups\.flatMap/.test(
    require("fs").readFileSync(modulePath("fluids-tools.js"), "utf8"),
  ),
  "a second hand-written list would be a second place to keep in step",
);

check(
  "the toolbar reads the registry rather than restating the tools",
  /FLUIDS:\s*fluidsToolGroups/.test(
    require("fs").readFileSync(modulePath("tools.js"), "utf8"),
  ),
  "the Fluids groups must come from their own module",
);

check(
  "the readers are one-line lookups over the registry",
  typeof fluids.fluidsCapability === "function" &&
    typeof fluids.fluidsGeometryTool === "function" &&
    typeof fluids.fluidsAnnotateKind === "function",
);

/* The readers answer for the entries they describe. */
check(
  "fluidsGeometryTool returns a shape entry's primitive",
  fluids.fluidsGeometryTool("reservoir-tank") === "rectangle",
);
check(
  "fluidsGeometryTool answers null for a route entry (it is not a shape)",
  fluids.fluidsGeometryTool("pipe-duct") === null,
);
check(
  "fluidsCapability reports the route capability for Pipe / Duct",
  fluids.fluidsCapability("pipe-duct") === capabilities.ROUTE,
);
check(
  "fluidsAnnotateKind returns an annotate entry's kind",
  fluids.fluidsAnnotateKind("flow-arrow") === "arrow",
);
check(
  "fluidsCapability returns a dimension entry's capability",
  fluids.fluidsCapability("pipe-diameter") === capabilities.DIMENSION,
);

/* ============================================================
 * 8. THE SHARED SYSTEMS ASK THE REGISTRY
 * ============================================================ */

console.log("\n  the shared systems ask the registry, not a second list\n");

{
  const annotateCreation = require("fs").readFileSync(
    modulePath("annotate-creation.js"),
    "utf8",
  );

  check(
    "the Annotate layer resolves a Fluids tool to its kind",
    /annotateKindFor[\s\S]{0,400}fluidsAnnotateKind/.test(annotateCreation),
  );

  const dimensionTool = require("fs").readFileSync(
    modulePath("dimension-tool.js"),
    "utf8",
  );

  check(
    "the dimension layer routes a Fluids measurement to its own engine",
    /isDimensionTool[\s\S]{0,600}fluidsCapability/.test(dimensionTool),
  );

  const activation = require("fs").readFileSync(
    modulePath("tool-activation.js"),
    "utf8",
  );

  check(
    "activation arms the shared system the entry names",
    /fluidsArmedTool/.test(activation) && /fluidsInstruction/.test(activation),
  );

  const toolbar = require("fs").readFileSync(
    modulePath("tool-menus.js"),
    "utf8",
  );

  check(
    "the toolbar highlights a Fluids button when its shared tool runs",
    /isFluidsToolActive/.test(toolbar),
  );
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);

if (fail) {
  process.exitCode = 1;
}
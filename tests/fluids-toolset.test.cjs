/* eslint-disable no-console */
/*
 * ========================================================
 * THE FLUIDS TOOLSET: FOUR SECTIONS, TWO INLINE GROUPS
 * ========================================================
 *
 * The requirement is structural and specific: Fluids is organised the way
 * Statics is - the same four SECTIONS, independent of one another - with two
 * teams inside Create that EXPAND IN PLACE.
 *
 *     Selection   Select
 *     Create      Flow Paths [inline group] / five individual tools /
 *                 Flow Indicators [inline group]
 *     Analysis    the two diagrams
 *     Reference   the four reference tools
 *
 * That is easy to undo by accident: a group nested inside Create as a heading,
 * or Analysis moved under Create, would leave every tool reachable and nothing
 * would throw. So the shape is asserted here, against the registry the toolbar
 * actually reads.
 *
 * The two groups are checked to use the SAME mechanism Statics uses - the
 * `submenu: true` flag plus the toolbar's inline `.drawing-inline-tools`
 * subsection - and NOT a popup.
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

/*
 * The tools of a section, with a group's contents flattened in. Create holds
 * two expandable groups; the rest hold a flat list.
 */
const toolsIn = (group) =>
  (group.tools || []).flatMap((tool) =>
    tool.submenu ? fluids.FLUIDS_TOOL_MENUS[tool.id] || [] : [tool],
  );

/* The individual tools of a section - the ones NOT behind a group. */
const directToolsIn = (group) =>
  (group.tools || []).filter((tool) => !tool.submenu);

/* ============================================================
 * 1. THE FOUR SECTIONS, IN STATICS' ORDER
 * ============================================================ */

console.log("\n  four sections, in the order Statics uses\n");

const expectedCategories = ["Selection", "Create", "Analysis", "Reference"];

check(
  "the Fluids toolset declares four sections",
  groups.length === 4,
  `found ${groups.length}`,
);

check(
  "the sections are exactly the four Statics uses, in order",
  groups.map((group) => group.label).join(" | ") ===
    expectedCategories.join(" | "),
  groups.map((group) => group.label).join(" | "),
);

/* The four sections must match Statics exactly - same names, same order. */
{
  const toolsJs = require("fs").readFileSync(modulePath("tools.js"), "utf8");
  const staticsBlock = toolsJs.slice(
    toolsJs.indexOf("STATICS: ["),
    toolsJs.indexOf("const globalToolGroups"),
  );
  const staticsSections = [...staticsBlock.matchAll(/label: "(Selection|Create|Analysis|Reference)"/g)].map(
    (match) => match[1],
  );

  check(
    "Fluids and Statics name their sections identically",
    staticsSections.join(" | ") === expectedCategories.join(" | "),
    `Statics: ${staticsSections.join(" | ")}`,
  );
}

check(
  "Select is the FIRST section",
  groups[0].label === "Selection" &&
    groups[0].tools.some((tool) => tool.id === "select"),
  "selection always comes first, exactly as it does in Statics",
);

/* ============================================================
 * 2. EVERY TOOL, IN ITS CORRECT SECTION AND GROUP
 * ============================================================ */

console.log("\n  every tool is in the section and group the requirement names\n");

const expectedTools = {
  Selection: ["select"],
  Create: [
    "pipe-duct",
    "elbow",
    "junction",
    "reducer-expander",
    "flow-arrow",
    "fluid-level",
    "reservoir-tank",
    "pump",
    "valve",
    "flow-meter",
  ],
  Analysis: ["flow-direction-diagram", "flow-profile", "pressure-profile"],
  Reference: [
    "coordinate-system",
    "reference-point",
    "reference-line",
    "section-plane",
  ],
};

Object.entries(expectedTools).forEach(([section, ids]) => {
  const group = groups.find((entry) => entry.label === section);

  check(
    `"${section}" holds its tools, in order`,
    Boolean(group) &&
      toolsIn(group).map((tool) => tool.id).join(" | ") === ids.join(" | "),
    group ? toolsIn(group).map((tool) => tool.id).join(" | ") : "section missing",
  );
});

/*
 * CREATE, ENTRY BY ENTRY, IN THE ORDER THE SIDEBAR SHOWS THEM:
 * the two groups and the five individual tools, interleaved as required.
 */
{
  const create = groups.find((group) => group.label === "Create");
  const entries = (create?.tools || []).map((tool) => tool.label);

  check(
    "Create lists its groups and tools in the required order",
    entries.join(" | ") ===
      "Flow Paths | Flow Indicators & Annotations | Reservoir / Tank | " +
        "Pump | Valve | Flow Meter",
    entries.join(" | "),
  );

  check(
    "Create has no Equipment group",
    !entries.includes("Equipment"),
    entries.join(" | "),
  );

  check(
    "Create's second group is Flow Indicators & Annotations, not a separate Annotations group",
    entries.filter((label) => /annotation/i.test(label)).join(" | ") === "Flow Indicators & Annotations",
    entries.join(" | "),
  );

  check(
    "Reservoir / Tank, Pump, Valve and Flow Meter are individual tools",
    directToolsIn(create)
      .map((tool) => tool.id)
      .join(" | ") ===
      "reservoir-tank | pump | valve | flow-meter",
    directToolsIn(create)
      .map((tool) => tool.id)
      .join(" | "),
  );

  check(
    "only Flow Paths and Flow Indicators are groups",
    (create?.tools || [])
      .filter((tool) => tool.submenu)
      .map((tool) => tool.label)
      .join(" | ") === "Flow Paths | Flow Indicators & Annotations",
    (create?.tools || [])
      .filter((tool) => tool.submenu)
      .map((tool) => tool.label)
      .join(" | "),
  );
}

/* The contents of the two groups, exactly as the requirement names them. */
const groupContents = {
  "fluids-flow-paths": ["pipe-duct", "elbow", "junction", "reducer-expander"],
  /* Flow Arrow and Fluid Level only - Pressure Tap is not a listed tool. */
  "fluids-flow-indicators": ["flow-arrow", "fluid-level"],
};

Object.entries(groupContents).forEach(([groupId, ids]) => {
  const items = fluids.FLUIDS_TOOL_MENUS[groupId] || [];

  check(
    `${groupId} holds its tools, in order`,
    items.map((item) => item.id).join(" | ") === ids.join(" | "),
    items.map((item) => item.id).join(" | ") || "group missing",
  );
});

/* ============================================================
 * 3. EIGHTEEN TOOLS, NO MORE AND NO FEWER
 * ============================================================ */

console.log("\n  the eighteen listed tools\n");

const allIds = groups.flatMap((group) => toolsIn(group).map((tool) => tool.id));

check(
  "there are exactly eighteen tools",
  allIds.length === 18,
  `found ${allIds.length}: ${allIds.join(", ")}`,
);

check(
  "no group is also declared as a tool",
  !allIds.some((id) => Object.hasOwn(fluids.FLUIDS_TOOL_MENUS, id)),
  allIds.join(", "),
);

["pipe-diameter", "fluid-property-label", "flow-rate-label", "elevation-marker"].forEach(
  (id) => {
    check(
      `no "${id}" tool is offered`,
      !allIds.includes(id) && !groups.some((g) => toolsIn(g).some((t) => t.id === id)),
      "the requirement excludes it from the section",
    );
  },
);

check(
  "no tool id is declared twice",
  new Set(allIds).size === allIds.length,
  allIds.join(", "),
);

check(
  "the flat registry holds one entry per tool",
  Object.keys(fluids.FLUIDS_TOOLS).length === 18,
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
 * 5. UNBUILT TOOLS ARE HONEST
 * ============================================================ */

console.log("\n  an unbuilt tool says so and arms nothing\n");

/*
 * Everything except Select and the three shared Reference tools has no
 * behaviour yet, so every one of them must be `planned` - registered and
 * visible, never presented as working.
 */
const BUILT = [
  "select",

  /*
   * PIPE / DUCT IS IMPLEMENTED: the route gesture, the run feature, the elbow
   * generated at a supported corner and the TikZ both write. It is the reason
   * this list is no longer four shared tools.
   */
  "pipe-duct",

  /*
   * ELBOW IS IMPLEMENTED: the same press-drag-release gesture, its own
   * one-object fitting, and the same connection record an automatically
   * generated fitting uses.
   */
  "elbow",

  /*
   * JUNCTION IS IMPLEMENTED TOO: the same gesture, one fitting owning three or
   * more branches, and the same connection record.
   */
  "junction",

  /*
   * FLOW ARROW IS IMPLEMENTED: a free arrow everywhere, and the pipe-attached
   * indicator when the press lands on a run.
   */
  "flow-arrow",

  "fluid-level",

  /*
   * AND EVERY SCHEMATIC TOOL IS NOW IMPLEMENTED. Each has its own model, its
   * own renderer, its own Features sections, its own source writer and reader,
   * and its own gesture - so none of them is `planned` any more.
   */
  "reducer-expander",
  "reservoir-tank",
  "pump",
  "valve",
  "flow-meter",
  "flow-direction-diagram",
  "flow-profile",
  "pressure-profile",
  "coordinate-system",
  "reference-point",
  "reference-line",
  "section-plane"
];

const planned = allIds.filter((id) => fluids.isPlannedFluidsTool(id));
const built = allIds.filter((id) => !fluids.isPlannedFluidsTool(id));

check(
  "exactly the built tools are not planned",
  [...built].sort().join(" | ") === [...BUILT].sort().join(" | "),
  built.join(" | "),
);

check(
  "every other entry is planned",
  planned.length === allIds.length - BUILT.length,
  `${planned.length} planned, expected ${allIds.length - BUILT.length}`,
);

/* A planned entry is described as unavailable, not as a working tool. */
{
  const { fluidsInstruction } = loadModule("fluids-tool.js");

  check(
    "a planned tool's instruction says it is not available yet",
    planned.every((id) => /is not available yet/.test(fluidsInstruction(id))),
    planned.map((id) => `${id}: ${fluidsInstruction(id)}`).join("; "),
  );

  check(
    "activation refuses a planned tool before it arms anything",
    /isPlannedFluidsTool\(toolId\)[\s\S]{0,120}return;/.test(
      require("fs").readFileSync(modulePath("tool-activation.js"), "utf8"),
    ),
  );
}

/* ============================================================
 * 6. SHARED TOOLS ARE REUSED, NOT DUPLICATED
 * ============================================================ */

console.log("\n  Select and Reference reuse the shared tools\n");

{
  const toolsJs = require("fs").readFileSync(modulePath("tools.js"), "utf8");
  const staticsBlock = toolsJs.slice(toolsJs.indexOf("STATICS: ["));
  const shared = [
    "select",
    "coordinate-system",
    "reference-point",
    "reference-line",
  ];

  shared.forEach((id) => {
    check(
      `"${id}" is the same id Statics lists`,
      staticsBlock.includes(`id: "${id}"`),
      "a copied id would be a second tool with the same name",
    );
  });

  const ids = allIds;
  check(
    "no Fluids-prefixed copy of a shared tool exists",
    !ids.some((id) => /^fluids-(select|coordinate-system|reference-point|reference-line)$/.test(id)),
    "Select and the reference tools are reused by id",
  );
}

/* ============================================================
 * 7. EVERY ENTRY HAS AN ICON
 * ============================================================ */

console.log("\n  every entry has an icon and a tooltip label\n");

{
  const { toolIcons } = loadModule("tools.js");

  const iconless = groups
    .flatMap(toolsIn)
    .filter((tool) => !toolIcons[tool.iconLabel || tool.label]);

  check(
    "no entry falls back to a blank icon",
    iconless.length === 0,
    iconless.map((tool) => tool.id).join(", "),
  );
}

/* ============================================================
 * 8. EVERY ENTRY IS BOUND TO AN EXISTING SYSTEM
 * ============================================================ */

console.log("\n  every entry is bound to a DAETUM system or is declared planned\n");

const capabilities = fluids.FLUIDS_CAPABILITIES;
const validCapabilities = Object.values(capabilities);

check(
  "the capability table names the shared systems",
  validCapabilities.join(" | ") ===
    "select | shape | route | dimension | annotate | flow-arrow | inline-fitting | inline-equipment | vessel | fluid-level | flow-direction | analysis-diagram | flow-profile | section | planned",
  validCapabilities.join(" | "),
);

const unbounded = groups
  .flatMap(toolsIn)
  .filter((tool) => !validCapabilities.includes(tool.capability));

check(
  "no entry is left without a capability",
  unbounded.length === 0,
  unbounded.map((tool) => tool.id).join(", ") ||
    "an unbound entry is a button with nothing behind it",
);

/* A shape entry must name the primitive it draws with. */
const shapeEntries = groups
  .flatMap(toolsIn)
  .filter((tool) => tool.capability === capabilities.SHAPE);

check(
  "every shape entry names the geometry tool it draws with",
  shapeEntries.length > 0 &&
    shapeEntries.every((tool) =>
      ["line", "rectangle", "circle", "point"].includes(tool.geometryTool),
    ),
  shapeEntries.map((tool) => `${tool.id}:${tool.geometryTool}`).join(", "),
);

/*
 * An annotate entry must name a real Annotate kind.
 *
 * No entry is an annotate tool at present - the two that were (Flow Arrow and
 * Fluid Level) have no behaviour yet and are declared `planned`. The rule still
 * runs, vacuously today, so the first annotate entry added must name a real
 * kind rather than breaking the Annotate layer at click time.
 */
const annotateModule = loadModule("annotate-model.js");
const annotate = annotateModule.default || annotateModule;

const annotateEntries = groups
  .flatMap(toolsIn)
  .filter((tool) => tool.capability === capabilities.ANNOTATE);

check(
  "every annotate entry names a real Annotate kind",
  annotateEntries.every((tool) =>
    Boolean(annotate.ANNOTATE_KINDS[tool.annotateKind]),
  ),
  annotateEntries
    .map((tool) => `${tool.id}:${tool.annotateKind}`)
    .join(", ") || "none today - every annotate tool is planned",
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
  fluids.fluidsGeometryTool("reference-line") === "line",
);
check(
  "fluidsGeometryTool answers null for a planned entry (it has no primitive yet)",
  fluids.fluidsGeometryTool("pipe-duct") === null,
);
check(
  "fluidsCapability reports the shared-shape capability for a reference tool",
  fluids.fluidsCapability("reference-line") === capabilities.SHAPE,
);
check(
  "every listed tool now carries a real capability, and none is left planned",
  /*
   * The scope is complete: each of the eighteen listed tools travels a working
   * system, so the "not available yet" state is carried by nothing in this
   * section. Pressure Tap was removed with it - the specification's Flow
   * Indicators & Annotations group holds the Flow Arrow and the Fluid Level.
   */
  allIds.every((id) => fluids.fluidsCapability(id) !== capabilities.PLANNED) &&
    fluids.fluidsCapability("pressure-tap") === null,
);
check(
  "fluidsCapability reports the schematic capability for a fluid level",
  fluids.fluidsCapability("fluid-level") === capabilities.FLUID_LEVEL,
);
check(
  "fluidsArmedTool arms a reference tool's own shared id",
  loadModule("fluids-tool.js").fluidsArmedTool("reference-line") === "line",
);

/* ============================================================
 * 7b. THE GROUPS EXPAND INLINE, THE WAY STATICS' DO
 * ============================================================ */

console.log("\n  the groups expand inline through the Statics mechanism\n");

{
  const renderer = require("fs").readFileSync(modulePath("toolbar-render.js"), "utf8");
  const inlineTable = renderer.slice(
    renderer.indexOf("const expandedToolbarSections"),
    renderer.indexOf("function renderToolGroup"),
  );

  ["fluids-flow-paths", "fluids-flow-indicators"].forEach((id) => {
    check(
      `"${id}" is registered for inline expansion`,
      inlineTable.includes(`"${id}": false`),
      "only a key in that table is rendered as an inline subsection",
    );
  });

  check(
    "the inline subsection is the shared Statics one, not a popup",
    /FLUIDS_TOOL_MENUS\[tool\.id\]/.test(
      renderer,
    ) && /class="drawing-inline-tools"/.test(renderer),
    "the children must be rendered as buttons inside .drawing-inline-tools",
  );

  check(
    "the toolbar opens NO floating menu for a Fluids group",
    !/openToolSubmenu|openFluidsMenu/.test(renderer),
    "a popup would take the tools out of the sidebar",
  );

  check(
    "the click handler toggles the inline subsection (the Statics path)",
    /Object\.hasOwn\(expandedToolbarSections, toolId\)[\s\S]{0,400}#statics-\$\{toolId\}-tools["\s\S]{0,80}hidden = !expanded/.test(
      renderer,
    ),
  );

  /* The two groups really are reachable through that flag. */
  const create = groups.find((group) => group.label === "Create");

  (create?.tools || [])
    .filter((tool) => tool.submenu)
    .forEach((tool) => {
      check(
        `"${tool.label}" carries the Statics submenu flag so it expands inline`,
        tool.submenu === true && Boolean(fluids.FLUIDS_TOOL_MENUS[tool.id]),
      );
    });
}

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

/*
 * ========================================================
 * HEAT TRANSFER: THE TOOLSET
 * ========================================================
 *
 * The Heat Transfer section is organised EXACTLY the way Statics and Fluids
 * are: the same FOUR category headings, each with its commands listed DIRECTLY
 * underneath.
 *
 *     SELECTION            the shared selection system, offered first
 *     CREATE               the regions, walls, paths, boundaries and circuit
 *     ANALYSIS             the three drawn analysis objects
 *     REFERENCE            the shared reference geometry
 *
 * THE FOUR SECTIONS ARE INDEPENDENT, AND STAY THAT WAY.
 *
 * Analysis and Reference are SECTIONS OF THEIR OWN at the top level - they are
 * not headings buried inside Create. A student who has learned where a Statics
 * or a Fluids tool lives should find the Heat Transfer map already familiar.
 *
 * CREATE HAS FIVE DROPDOWNS, AND NOTHING ELSE HIDDEN.
 *
 * Heat Transfer Path, Thermal Transfer Arrow, Thermal Boundary, Heat Source /
 * Sink and Thermal Circuit Element open the SAME shared submenu a Statics
 * Bodies / Loads / Supports entry opens (`submenu: true`), so the caret, the
 * inline expansion, the positioning and the keyboard handling are the shared
 * ones and not a second implementation. Everything else under Create - Thermal
 * Region, Wall / Slab, Composite Wall, Fin, Thermal Contact / Interface and
 * Thermal Circuit Node - is an INDIVIDUAL TOOL listed directly under the
 * heading. There is no Thermal Geometry group and no Circuit dropdown: a tool
 * behind a menu has to be gone looking for, and one that stands on its own
 * does not.
 *
 * ========================================================
 * THE `capability` FIELD IS THE MODULARITY
 * ========================================================
 *
 * Each entry names the shared system it travels. Adding a real Heat Transfer
 * behaviour later means giving its entry a capability of its own and
 * implementing that capability - NOT restructuring this section, and not
 * editing the toolbar, the icons or the categories. The section is a registry
 * of entries, and the behaviour behind an entry is one field.
 *
 *     capability     the shared system it uses                status
 *     ───────────    ─────────────────────────────────────    ───────
 *     select         the ordinary selection system            working
 *     shape          the geometry creation pipeline           working
 *     heat           the Heat Transfer object sessions        working
 *     graph          the existing Graph / Plot tool           working
 *     planned        registered, behaviour not built yet      the honest fallback
 */

/*
 * The capability ids, named once so the strings are not spelled out at each
 * entry. A capability is the INTERFACE between this registry and the shared
 * system behind it.
 */
export const HEAT_CAPABILITIES = Object.freeze({
  SELECT: "select",

  /*
   * A SHAPE ENTRY NAMES THE PRIMITIVE IT IS DRAWN WITH. A Thermal Region is
   * drawn as a rectangle (or through the existing polygon workflow), so the
   * entry carries a `geometryTool` naming the ordinary geometry tool it
   * reuses. That is the reuse the requirement asks for: the region snaps,
   * previews, commits, selects, moves, saves and undoes through the SAME
   * pipeline as a Rectangle, because it IS drawn with the Rectangle's own
   * gesture. What makes it a Thermal Region rather than a Rectangle - its own
   * feature type, its own panel, its own rendering - is the model this module
   * adds on top.
   */
  SHAPE: "shape",

  /*
   * A HEAT ENTRY is one of the Heat Transfer objects with its own model, its
   * own session and its own renderer. These are grouped by the GESTURE they
   * take, recorded as `gesture` on the entry:
   *
   *   drag        press-drag-release: Wall / Slab, Composite Wall, Fin,
   *               the boundaries, the arrows, the isotherm's rectangle form
   *   span        two clicks (or a drag): the heat transfer paths, the
   *               thermal transfer arrows, the interface
   *   poly        click a start, click more points, finish: paths, isotherm
   *   click       one press places the object: source/sink, node, marker
   */
  HEAT: "heat",

  /*
   * THE GRAPH ENTRY reuses the existing Graph / Plot tool with a Heat
   * Transfer preset. It is deliberately NOT its own plotting engine.
   */
  GRAPH: "graph",

  PLANNED: "planned",
});

/*
 * ========================================================
 * THE FOUR SECTIONS AND THEIR ENTRIES
 * ========================================================
 *
 * Heat Transfer is laid out the way Statics and Fluids are: the SAME FOUR
 * SECTIONS, in the SAME ORDER - Selection, Create, Analysis, Reference. A
 * student who has learned where a Statics or a Fluids tool lives already knows
 * where to look here.
 *
 * CREATE IS A MIX OF DROPDOWNS AND DIRECT TOOLS, exactly as the Statics Create
 * section is. A dropdown entry carries `submenu: true` - the same flag a
 * Statics Bodies or Loads entry carries - and expands IN PLACE underneath its
 * own button, inside the sidebar, through the toolbar's existing inline-section
 * mechanism. It opens no popup. Every entry without the flag arms immediately.
 * The CONTENTS of a dropdown live in `HEAT_TOOL_MENUS` below, one list per
 * parent, so the button and the tools it reveals cannot disagree.
 *
 * EVERY ENTRY CARRIES FOUR THINGS AND NOTHING ELSE:
 *
 *     id            the tool id, used by the toolbar, activation and routing
 *     label         the student-facing name; the ICON is looked up by this
 *     capability    which shared system the tool travels (see above)
 *     geometryTool  only on a `shape` entry: the ordinary geometry tool it
 *                   draws with, so it travels the shared creation pipeline
 *     gesture       only on a `heat` entry: the placement gesture it takes
 *
 * THE ORDER OF THE CREATE TOOLS IS THE REQUIREMENT'S OWN:
 *
 *   1  Thermal Region          direct
 *   2  Wall / Slab             direct
 *   3  Composite Wall          direct
 *   4  Fin                     direct
 *   5  Heat Transfer Path      dropdown
 *   6  Thermal Transfer Arrow  dropdown
 *   7  Thermal Boundary        dropdown
 *   8  Thermal Contact / Interface   direct
 *   9  Heat Source / Sink      dropdown
 *   10 Thermal Circuit Node    direct
 *   11 Thermal Circuit Element dropdown
 */
export const heatToolGroups = [
  /*
   * SELECTION IS THE SHARED SELECT.
   *
   * `select` is the universal DAETUM tool - the same id Statics, Dynamics and
   * Annotate arm - so this section is a second DOOR to it, not a second copy.
   */
  {
    id: "heat-selection",
    label: "Selection",
    tools: [
      {
        id: "select",
        label: "Select",
        shortcut: "Esc",
        capability: HEAT_CAPABILITIES.SELECT,
      },
    ],
  },

  /*
   * CREATE: THE ELEVEN ENTRIES, IN THE REQUIREMENT'S ORDER.
   *
   * The five dropdowns come exactly where the requirement puts them - Path
   * fifth, Arrow sixth, Boundary seventh, Source/Sink ninth, Circuit Element
   * eleventh - and the six direct tools fill the slots between them.
   */
  {
    id: "heat-create",
    label: "Create",
    tools: [
      {
        id: "thermal-region",
        label: "Thermal Region",
        capability: HEAT_CAPABILITIES.HEAT,
        gesture: "drag",
      },
      {
        id: "wall-slab",
        label: "Wall / Slab",
        capability: HEAT_CAPABILITIES.HEAT,
        gesture: "drag",
      },
      {
        id: "composite-wall",
        label: "Composite Wall",
        capability: HEAT_CAPABILITIES.HEAT,
        gesture: "drag",
      },
      {
        id: "fin",
        label: "Fin",
        capability: HEAT_CAPABILITIES.HEAT,
        gesture: "drag",
      },

      /* 5 - the three heat transfer paths. */
      { id: "heat-transfer-path", label: "Heat Transfer Path", submenu: true },

      /* 6 - the two quantity arrows. */
      {
        id: "thermal-transfer-arrow",
        label: "Thermal Transfer Arrow",
        submenu: true,
      },

      /* 7 - the five boundary variants. */
      { id: "thermal-boundary", label: "Thermal Boundary", submenu: true },

      {
        id: "thermal-contact",
        label: "Thermal Contact / Interface",
        capability: HEAT_CAPABILITIES.HEAT,
        gesture: "span",
      },

      /* 9 - the source and the sink. */
      { id: "heat-source-sink", label: "Heat Source / Sink", submenu: true },

      {
        id: "thermal-circuit-node",
        label: "Thermal Circuit Node",
        capability: HEAT_CAPABILITIES.HEAT,
        gesture: "click",
      },

      /* 11 - the two circuit elements. */
      {
        id: "thermal-circuit-element",
        label: "Thermal Circuit Element",
        submenu: true,
      },
    ],
  },

  /*
   * ANALYSIS: THREE DRAWN OBJECTS AND THE EXISTING GRAPH.
   *
   * All four are DRAWING tools: the student places a marker, a contour or a
   * boundary themselves, exactly as they place a Shear Force Diagram in
   * Statics or a Pressure Profile in Fluids. None reads the drawing and
   * reports a result, and none will: a temperature field is the student's own
   * reasoning, drawn.
   *
   * TEMPERATURE PROFILE IS THE EXISTING GRAPH / PLOT TOOL with a Heat
   * Transfer preset. It is deliberately NOT a second plotting engine: the
   * preset sets the vertical axis to temperature and hands the gesture to the
   * graph tool that already exists.
   */
  {
    id: "heat-analysis",
    label: "Analysis",
    tools: [
      {
        id: "temperature-marker",
        label: "Temperature Marker",
        capability: HEAT_CAPABILITIES.HEAT,
        gesture: "click",
      },
      {
        id: "isotherm",
        label: "Isotherm",
        capability: HEAT_CAPABILITIES.HEAT,
        gesture: "poly",
      },
      {
        id: "control-volume-boundary",
        label: "Control Volume Boundary",
        capability: HEAT_CAPABILITIES.HEAT,
        gesture: "drag",
      },
      {
        id: "temperature-profile",
        label: "Temperature Profile",
        capability: HEAT_CAPABILITIES.GRAPH,
      },
    ],
  },

  /*
   * REFERENCE: THE SHARED REFERENCE TOOLS.
   *
   * Coordinate System, Reference Point and Reference Line are the SAME ids
   * Statics and Fluids list, so they arm the same tools - reference geometry
   * is reference geometry, whichever discipline asked for it. They keep their
   * normal `shape` entries: marking a working tool `planned` would make its
   * button say "not available yet" about a tool that is.
   *
   * No Heat Transfer-specific reference object is introduced: the requirement
   * asks for none.
   */
  {
    id: "heat-reference",
    label: "Reference",
    tools: [
      {
        id: "coordinate-system",
        label: "Coordinate System",
        capability: HEAT_CAPABILITIES.SHAPE,
        geometryTool: "point",
      },
      {
        id: "reference-point",
        label: "Reference Point",
        capability: HEAT_CAPABILITIES.SHAPE,
        geometryTool: "point",
      },
      {
        id: "reference-line",
        label: "Reference Line",
        capability: HEAT_CAPABILITIES.SHAPE,
        geometryTool: "line",
      },
    ],
  },
];

/*
 * ========================================================
 * THE DROPDOWN CONTENTS
 * ========================================================
 *
 * One list per `submenu: true` entry above, keyed by that entry's id. This is
 * the SAME shape as `STATICS_TOOL_MENUS` and `FLUIDS_TOOL_MENUS`, so the
 * toolbar renders it with the SAME inline subsection - the tools open
 * underneath the heading, in the sidebar - and a tool arms through the normal
 * activation path.
 *
 * THE PARENT IS NOT A TOOL. Pressing Heat Transfer Path or Thermal Boundary
 * expands or collapses the group and creates nothing; the child is what arms.
 * The children are declared HERE, once, and the flat registry below is built
 * from this table - so the tools the sidebar shows and the registry the
 * activation layer reads are the same statement of fact.
 *
 * Every variant shares its parent's underlying geometry and editing
 * infrastructure. What a variant changes is the FEATURE TYPE created and the
 * decoration it is drawn with - never the placement gesture, which the parent
 * and all its children share.
 */
export const HEAT_TOOL_MENUS = {
  /*
   * HEAT TRANSFER PATH: one path-editing infrastructure, three geometries.
   *
   * All three are placed by the same click-points-then-finish gesture and are
   * edited by the same point handles; what differs is how the path between the
   * points is drawn - straight segments with an arrowhead, a smooth streamline,
   * or a generated radiation wave.
   */
  "heat-transfer-path": [
    {
      id: "conduction-path",
      label: "Conduction Path",
      capability: HEAT_CAPABILITIES.HEAT,
      gesture: "poly",
    },
    {
      id: "convection-flow",
      label: "Convection Flow",
      capability: HEAT_CAPABILITIES.HEAT,
      gesture: "poly",
    },
    {
      id: "radiation-path",
      label: "Radiation Path",
      capability: HEAT_CAPABILITIES.HEAT,
      gesture: "poly",
    },
  ],

  /*
   * THERMAL TRANSFER ARROW: one arrow geometry, two quantities.
   *
   * Both are an editable arrow with an attached text node, placed by the same
   * span gesture; what differs is the quantity type and the default notation.
   * The two are NEVER interchangeable - a Heat Transfer Rate and a Heat Flux
   * are different quantities with different default labels.
   */
  "thermal-transfer-arrow": [
    {
      id: "heat-transfer-rate",
      label: "Heat Transfer Rate",
      capability: HEAT_CAPABILITIES.HEAT,
      gesture: "span",
    },
    {
      id: "heat-flux",
      label: "Heat Flux",
      capability: HEAT_CAPABILITIES.HEAT,
      gesture: "span",
    },
  ],

  /*
   * THERMAL BOUNDARY: one boundary-line geometry, FOUR decorations.
   *
   * All four are the same editable boundary segment; the variant decides the
   * symbols and annotations generated along it. Switching the variant replaces
   * the symbol set rather than leaving several overlapping.
   *
   * There is deliberately no Prescribed Heat-Flux Boundary. It drew the same
   * thing a Heat Flux ARROW draws - a normal-direction heat flux off a surface -
   * so a second object for it was a duplicate of a tool the student already has.
   * A heat flux on a surface is a Heat Flux arrow snapped to the boundary, which
   * reuses the arrow's own geometry, label and editing.
   */
  "thermal-boundary": [
    {
      id: "fixed-temperature-boundary",
      label: "Fixed Temperature",
      capability: HEAT_CAPABILITIES.HEAT,
      gesture: "span",
    },
    {
      id: "convection-boundary",
      label: "Convection Boundary",
      capability: HEAT_CAPABILITIES.HEAT,
      gesture: "span",
    },
    {
      id: "radiation-boundary",
      label: "Radiation Boundary",
      capability: HEAT_CAPABILITIES.HEAT,
      gesture: "span",
    },
    {
      id: "adiabatic-boundary",
      label: "Adiabatic / Insulated Boundary",
      capability: HEAT_CAPABILITIES.HEAT,
      gesture: "span",
    },
  ],

  /*
   * HEAT SOURCE / SINK: one composite symbol, two directions.
   *
   * Both are a source/sink body with a directional marker; what differs is
   * whether the marker shows energy supplied to the system or removed from it.
   */
  "heat-source-sink": [
    {
      id: "heat-source",
      label: "Heat Source",
      capability: HEAT_CAPABILITIES.HEAT,
      gesture: "click",
    },
    {
      id: "heat-sink",
      label: "Heat Sink",
      capability: HEAT_CAPABILITIES.HEAT,
      gesture: "click",
    },
  ],

  /*
   * THERMAL CIRCUIT ELEMENT: one connector infrastructure, two symbols.
   *
   * Both are placed on the existing circuit-connector infrastructure and both
   * generate two connection ports; what differs is the symbol between them.
   */
  "thermal-circuit-element": [
    {
      id: "thermal-resistance",
      label: "Thermal Resistance",
      capability: HEAT_CAPABILITIES.HEAT,
      gesture: "click",
    },
    {
      id: "thermal-capacitance",
      label: "Thermal Capacitance",
      capability: HEAT_CAPABILITIES.HEAT,
      gesture: "click",
    },
  ],
};

/*
 * ========================================================
 * THE FLAT REGISTRY, DERIVED FROM THE GROUPS ABOVE
 * ========================================================
 *
 * One entry per tool, keyed by id, built FROM the groups and the menus rather
 * than written out a second time. Everything that needs to ask "what is this
 * Heat Transfer tool?" asks here, so the toolbar, the activation layer and any
 * future behaviour module read the SAME table - a tool cannot be added to a
 * dropdown and forgotten by the layer that has to handle it.
 *
 * A dropdown parent is NOT a tool and has no entry: a student clicking a
 * Conduction Path needs it in this table, and a student clicking Heat Transfer
 * Path is opening a menu. Each tool records WHERE the student found it as its
 * `group` - the dropdown's label for a menu child, the section's label
 * otherwise - so the status line and the Features panel can name the place
 * they looked.
 */
const toolsOfGroup = (group) =>
  (group.tools || []).flatMap((tool) => {
    const children = tool.submenu ? HEAT_TOOL_MENUS[tool.id] : null;

    return children
      ? children.map((child) => [child.id, { ...child, group: tool.label }])
      : [[tool.id, { ...tool, group: group.label }]];
  });

export const HEAT_TOOLS = Object.freeze(
  Object.fromEntries(heatToolGroups.flatMap(toolsOfGroup)),
);

/*
 * The tool ids in the order they are offered, for a caller that wants the
 * section as a list rather than as groups.
 */
export const HEAT_TOOL_IDS = Object.freeze(Object.keys(HEAT_TOOLS));

/*
 * ========================================================
 * WHAT A HEAT TRANSFER TOOL USES
 * ========================================================
 *
 * Three small readers, so a caller asks a QUESTION rather than testing the
 * registry's shape itself. Each is a one-line lookup today and a place to grow
 * a capability tomorrow.
 */
export function isHeatTool(toolId) {
  return Boolean(HEAT_TOOLS[toolId]);
}

export function heatCapability(toolId) {
  return HEAT_TOOLS[toolId]?.capability || null;
}

/*
 * The ordinary geometry tool a Heat Transfer shape entry draws with.
 *
 * Returns the tool id the shared creation pipeline already knows - `line`,
 * `rectangle` or `point` - so a Heat Transfer shape tool is drawn, snapped,
 * previewed, committed, selected, moved, saved and undone by the SAME code as
 * that geometry tool. A tool that is not a shape entry has no primitive and
 * answers null.
 */
export function heatGeometryTool(toolId) {
  const tool = HEAT_TOOLS[toolId];

  return tool?.capability === HEAT_CAPABILITIES.SHAPE
    ? tool.geometryTool || null
    : null;
}

/* The placement gesture a Heat Transfer `heat` entry takes, or null. */
export function heatGesture(toolId) {
  const tool = HEAT_TOOLS[toolId];

  return tool?.capability === HEAT_CAPABILITIES.HEAT
    ? tool.gesture || null
    : null;
}

/*
 * Whether a Heat Transfer tool is registered but its behaviour is not built
 * yet.
 *
 * The activation layer asks this to decide between starting the tool and
 * saying plainly that it is not available, rather than leaving a button that
 * appears to do nothing.
 */
export function isPlannedHeatTool(toolId) {
  return heatCapability(toolId) === HEAT_CAPABILITIES.PLANNED;
}

/*
 * THE OPENING INSTRUCTION FOR EACH HEAT TRANSFER TOOL.
 *
 * The status line always says what to do next, in the student's own words.
 * A tool behind a dropdown is asked for its own wording, so a Conduction Path
 * and a Radiation Path do not share a message that fits neither.
 */
export function heatInstruction(toolId) {
  return (
    {
      "thermal-region": "Drag to draw the Thermal Region",
      "wall-slab": "Drag along the wall to draw the Wall / Slab",
      "composite-wall":
        "Drag to draw the Composite Wall; widen it to add layers",
      fin: "Click the base, then drag out the Fin",

      "conduction-path": "Click the start, click more points, Enter to finish",
      "convection-flow":
        "Click the start, click control points, Enter to finish",
      "radiation-path": "Click the start, then the end of the Radiation Path",

      "heat-transfer-rate": "Drag to draw the Heat Transfer Rate arrow",
      "heat-flux": "Drag to draw the Heat Flux arrow",

      "fixed-temperature-boundary":
        "Drag to draw the Fixed Temperature boundary",
      "convection-boundary": "Drag to draw the Convection Boundary",
      "radiation-boundary": "Drag to draw the Radiation Boundary",
      "adiabatic-boundary": "Drag to draw the Adiabatic / Insulated boundary",

      "thermal-contact": "Drag to draw the Thermal Contact / Interface",

      "heat-source": "Click to place the Heat Source",
      "heat-sink": "Click to place the Heat Sink",

      "thermal-circuit-node": "Click to place the Thermal Circuit Node",

      "thermal-resistance": "Click to place the Thermal Resistance",
      "thermal-capacitance": "Click to place the Thermal Capacitance",

      "temperature-marker": "Click to place the Temperature Marker",
      isotherm: "Click points to draw the Isotherm; Enter to finish",
      "control-volume-boundary": "Drag to draw the Control Volume Boundary",
      "temperature-profile": "Drag to draw the Temperature Profile graph frame",
    }[toolId] || "Specify location"
  );
}

const enggHeatTools = {
  HEAT_CAPABILITIES,
  heatToolGroups,
  HEAT_TOOL_MENUS,
  HEAT_TOOLS,
  HEAT_TOOL_IDS,
  isHeatTool,
  heatCapability,
  heatGeometryTool,
  heatGesture,
  isPlannedHeatTool,
  heatInstruction,
};

export default enggHeatTools;

/*
 * ============================================================
 * THE DAETUM SEARCH INDEX
 * ============================================================
 *
 * Every place a student can go, in one list: every tool, the category and the
 * section that holds it, every command on the menu bar, every panel destination
 * and every source tool. The command-search field reads this list and nothing
 * else.
 *
 * WHY IT IS DERIVED RATHER THAN WRITTEN DOWN
 * ------------------------------------------
 * A catalogue typed out by hand is a second copy of the application, and the
 * first thing to go stale. So every entry here comes from the source that
 * already decides the thing:
 *
 *   tools, categories, sections   the definitions the toolbar renders
 *                                 (`tools.js`, `fluids-tools.js`,
 *                                 `dynamics-hierarchy.js`, `statics-tools.js`)
 *   the library's own hierarchy   `registry/tool-registry.json`
 *   commands                      `menu-commands.js`, where every item already
 *                                 carries its own `run`, `shortcut` and
 *                                 disabled state
 *   panels and views              the panel's tab list and the source tab's own
 *                                 tool buttons
 *   features on the sheet         the document itself - objects and the settings
 *                                 their Features panel offers
 *
 * A tool added to a section is therefore searchable the day it is declared,
 * with no edit here. A tool removed from a section leaves the search with it.
 * A renamed tool is found by its new name.
 *
 * ALIASES ARE DATA, NOT ENTRIES. A term is attached to an entry that must
 * already exist, so an alias can never become a result of its own, and one
 * pointing at something the application no longer offers is dropped rather than
 * shown as a result that cannot run.
 *
 * WHAT AN ENTRY CARRIES
 * ---------------------
 *
 *   id         stable identity, unique in the index
 *   type       "tool" | "section" | "command" | "panel" | "view" | "feature"
 *   label      what the student reads
 *   location   where it lives: "Fluids > Create > Flow Paths"
 *   terms      the words that find it, beyond its own label
 *   shortcut   the key that runs it, when one is bound
 *   disabled   true when the application would refuse it right now
 *   reason     WHY it is refused, in the student's words
 *   run        what activation does - the application's own handler
 *
 * THE `run` FUNCTIONS IMPORT THEIR HANDLER LAZILY, AND THAT IS STRUCTURAL.
 *
 * The tool and panel handlers live in modules that import this toolbar, so
 * importing them at the top of this file would close a cycle round the toolbar
 * - the failure that once stopped every Dynamics tool loading. The handler is
 * therefore imported at the moment the student picks the result, by which time
 * every module is evaluated. What the wrapper then calls is the same
 * `activateTool` and the same panel switch the interface itself uses, never a
 * second implementation of either.
 */

import {
  disciplineToolGroups,
  drawingToolGroups,
  drawToolLabelById,
  engineeringTools,
} from "./tools.js";
import { DYNAMICS_TOOL_MENUS } from "../../../features/workspace/dynamics/dynamics-tools.js";
import {
  FLUIDS_TOOL_MENUS,
  isPlannedFluidsTool,
} from "../../../features/workspace/model/fluids/fluids-tools.js";
import { STATICS_TOOL_MENUS } from "../../../features/workspace/statics/statics-tools.js";
import {
  ANALYSIS_DIAGRAM_MODES,
  ANALYSIS_DIAGRAM_MODE_LABELS,
} from "../../../features/workspace/statics/analysis-tools.js";
import { MENUS } from "../menu-bar/menu-commands.js";
import { isLegacyResetTool } from "./phase-reset.js";
import * as registry from "../../../tool-library/registry/tool-registry.js";
import * as featureSchema from "../panels/feature-schema.js";
import { drawingState } from "../../../features/workspace/editor-state.js";

/* ----------------------------------------------------------- lazy handlers */

/*
 * ACTIVATING A TOOL - AND MAKING SURE ITS CATEGORY IS THE ONE ON SCREEN.
 *
 * The same `activateTool` every tool button calls arms the tool, lights it and
 * sets its instruction. But a tool can be armed while its category is NOT the
 * visible one - that is exactly what a search does, and what the Edit menu's
 * Reference Point used to do - and arming it alone does not switch the toolset
 * bar. The student would be told the tool is running with nothing on screen to
 * show it.
 *
 * So the category is opened FIRST when it is not already showing. The button's
 * own click is used, so the reset, the re-render and the highlight are the
 * application's own. Then the tool is armed, and then its group is expanded - in
 * that order - because opening a category resets the tool, and the tool must
 * not be reset after it was armed.
 */
async function activateTool(toolId, discipline = null, groupId = null) {
  if (discipline) {
    openCategory(discipline, null);
  }

  const { activateTool: activate } = await import("./tool-activation.js");

  await activate(toolId);

  if (groupId) {
    expandGroup(groupId);
  }
}

/* The panel's tab switch - the same one its tab strip uses. */
function openPanelTab(tab) {
  return import("../panels/panel-tabs.js").then(({ openPanelTab: open }) =>
    open ? open(tab) : undefined,
  );
}

/* ------------------------------------------------------- categories as shown */

/*
 * THE DISCIPLINES, in the order the toolset bar shows them.
 *
 * `key` is the category the toolbar's buttons carry (`data-category`), so a
 * result opens a category the way a click does. `groups` is the section list
 * that category renders, or null when the category is a flat list of tools -
 * exactly the branch `renderEngineeringTools` takes.
 */
const DISCIPLINES = [
  {
    key: "GEOMETRY",
    title: "Geometry",
    groups: drawingToolGroups,
    terms: ["drawing", "shapes", "sketch", "cad", "draw"],
  },
  {
    key: "ANNOTATE",
    title: "Annotate",
    groups: disciplineToolGroups.ANNOTATE,
    terms: [
      "annotation",
      "annotations",
      "dimension",
      "text",
      "label",
      "note",
      "callout",
      "leader",
      "symbol",
      "table",
      "lettering",
    ],
  },
  {
    key: "STATICS",
    title: "Statics",
    groups: disciplineToolGroups.STATICS,
    terms: [
      "structure",
      "structural",
      "forces",
      "mechanics",
      "bodies",
      "loads",
      "supports",
      "reactions",
      "free body",
    ],
  },
  {
    key: "DYNAMICS",
    title: "Dynamics",
    groups: disciplineToolGroups.DYNAMICS,
    terms: [
      "motion",
      "kinematics",
      "particle",
      "spring",
      "pulley",
      "damper",
      "vibration",
    ],
  },
  {
    key: "FLUIDS",
    title: "Fluids",
    groups: disciplineToolGroups.FLUIDS,
    terms: [
      "fluid",
      "fluid mechanics",
      "hydraulics",
      "pipework",
      "pipe",
      "piping",
      "duct",
      "flow",
      "pump",
      "valve",
      "pressure",
    ],
  },
  {
    key: "THERMODYNAMICS",
    title: "Thermodynamics",
    groups: disciplineToolGroups.THERMODYNAMICS,
    terms: [
      "thermo",
      "cycles",
      "heat",
      "work",
      "entropy",
      "rankine",
      "brayton",
      "otto",
      "diesel",
      "carnot",
    ],
  },
  {
    key: "HEAT TRANSFER",
    title: "Heat Transfer",
    groups: null,
    terms: [
      "thermal",
      "conduction",
      "convection",
      "radiation",
      "temperature",
      "flux",
      "wall",
      "heat",
    ],
  },
  {
    key: "SOLID MECHANICS",
    title: "Solid Mechanics",
    groups: disciplineToolGroups["SOLID MECHANICS"],
    terms: [
      "stress",
      "strain",
      "strength of materials",
      "beam",
      "shaft",
      "solids",
    ],
  },
  {
    key: "MECHANICAL DESIGN",
    title: "Mechanical Design",
    groups: null,
    terms: [
      "machine design",
      "gear",
      "fastener",
      "hole",
      "part",
      "section view",
    ],
  },
  {
    key: "CONTROLS",
    title: "Controls",
    groups: null,
    terms: [
      "control systems",
      "block diagram",
      "feedback",
      "controller",
      "plant",
      "sensor",
      "signal",
    ],
  },
  {
    key: "MATH / ANALYSIS",
    title: "Math / Analysis",
    groups: null,
    terms: [
      "maths",
      "mathematics",
      "graphs",
      "equations",
      "vectors",
      "functions",
    ],
  },
];

/* ------------------------------------------------- children behind a group */

/*
 * THE CHILDREN OF A GROUP.
 *
 * A `submenu: true` entry opens its children in place, and the children live in
 * one table per discipline. Asking all three (rather than one per section)
 * means a group added to any of them is walked with no edit here. The families
 * that are not tables - the thermodynamic cycles and the 2D/3D coordinate
 * system pair - are mirrored below from the toolbar's own drawing code, and a
 * test holds the two together.
 */
function toolbarChildrenOf(toolId) {
  return (
    DYNAMICS_TOOL_MENUS[toolId] ||
    FLUIDS_TOOL_MENUS[toolId] ||
    STATICS_TOOL_MENUS[toolId] ||
    EXTRA_GROUP_CHILDREN[toolId] ||
    null
  );
}



/*
 * THE SHEAR-FORCE PARENT HAS NO CHILDREN TABLE.
 *
 * The toolbar gives `shear-force-diagram` its own inline list of the two ways a
 * diagram is drawn - Sketch and Plot - read from the analysis module's modes.
 * The SAME two lists are read here, so the parent is recognised as a group and
 * its rows are the labels the toolbar prints, not a copy of them.
 */
function analysisModeChildren() {
  return ANALYSIS_DIAGRAM_MODES.map((mode) => ({
    id: `shear-force-diagram:${mode}`,
    label: ANALYSIS_DIAGRAM_MODE_LABELS[mode] || mode,
    mode,
  }));
}

/* Mirrors the inline children `toolbar-render.js` draws from its own literals. */
const EXTRA_GROUP_CHILDREN = {
  "thermodynamic-cycles": [
    { id: "rankine-cycle", label: "Rankine Cycle" },
    { id: "reheat-rankine-cycle", label: "Ideal Reheat Rankine Cycle" },
    { id: "brayton-cycle", label: "Brayton Cycle" },
    { id: "otto-cycle", label: "Otto Cycle" },
    { id: "diesel-cycle", label: "Diesel Cycle" },
    { id: "carnot-cycle", label: "Carnot Cycle" },
    {
      id: "vapor-compression-cycle",
      label: "Ideal Vapor-Compression Refrigeration Cycle",
    },
  ],
  "steady-state-devices": [
    { id: "turbine-compressor", label: "Turbine / Compressor" },
    { id: "pipe-duct", label: "Pipe / Duct" },
    { id: "nozzle-diffuser", label: "Nozzle / Diffuser" },
  ],
  work: [
    { id: "work-arrow", label: "Work Arrow" },
    { id: "electric-work", label: "Electric Work" },
    { id: "mechanical-work", label: "Mechanical Work" },
  ],
  "heat-transfer": [
    { id: "heat-entering", label: "Heat Entering" },
    { id: "heat-leaving", label: "Heat Leaving" },
  ],
  "process-diagrams": [
    { id: "process-plot", label: "Process Plot" },
    { id: "saturation-curve", label: "Saturation Curve" },
    { id: "process-path", label: "Process Path" },
    { id: "constant-temp-pressure-lines", label: "Const Temp/Pressure Lines" },
  ],
  "piston-cylinder": [
    { id: "piston-cylinder", label: "Piston Cylinder" },
    { id: "piston-cylinder-stoppers", label: "Piston Cylinder with Stoppers" },
  ],
  "coordinate-system": [
    { id: "coordinate-system-2d", label: "2D Coordinate System" },
    { id: "coordinate-system-3d", label: "3D Coordinate System" },
  ],
};

/*
 * THE PARENT ENTRIES THAT ARE ONLY A PLACE TO OPEN A GROUP.
 *
 * Process Diagrams, Steady-State Devices, Work, Heat Transfer, Thermodynamic
 * Cycles and the Coordinate System pair carry `submenu: true` and open tools of
 * their own, but the PARENT creates nothing - it is a heading you expand. It is
 * still a real row on the toolbar, so it is indexed (under its group's name),
 * and the coverage test checks that this list and the toolbar's own parent
 * flags do not drift apart.
 */
const GROUP_PARENTS = [
  "body",
  "load",
  "support",
  "connection",
  "fluids-flow-paths",
  "fluids-flow-indicators",
  "dynamics-bodies",
  "dynamics-kinematics",
  "dynamics-mechanical",
  "shear-force-diagram",
  "reference-arc",
  "steady-state-devices",
  "piston-cylinder",
  "process-diagrams",
  "heat-transfer",
  "work",
  "thermodynamic-cycles",
  "coordinate-system",
];

/*
 * A PARENT WHOSE NAME IS ALSO A SECTION'S.
 *
 * `thermodynamic-cycles` is listed inside Thermodynamics > Create AND heads a
 * section of its own. It is one place, so it is indexed once - as that section -
 * and the Create entry is not repeated beside it.
 */
const COLLIDING_GROUPS = ["thermodynamic-cycles"];

/* The arc and polygon construction methods, as the sidebar lists them. */
const ARC_MODE_LABELS = ["Centrepoint Arc", "3-Point Arc"];
const POLYGON_MODE_LABELS = ["Polygon by Sides", "Polygon by Centre"];

/* ------------------------------------------------------------ tool status */

/*
 * The tools the interface really refuses today, with the reason it gives.
 *
 *   3D Coordinate System   there is no 3D canvas; the button reports so
 *   planned Fluids tools   registered, behaviour not built (fluids-tools.js)
 *   reset tools            the migration gate in phase-reset.js is closed
 *
 * Everything else is offered. The gate's own table decides rather than a list
 * kept here, so opening or closing the gate changes the search with it.
 */
function toolStatus(toolId) {
  if (toolId === "coordinate-system-3d") {
    return { disabled: true, reason: "Not available on the 2D drawing canvas" };
  }

  if (isPlannedFluidsTool(toolId)) {
    return {
      disabled: true,
      reason: "Registered, but its behaviour is not built yet",
    };
  }

  if (isLegacyResetTool(toolId)) {
    return {
      disabled: true,
      reason: "Temporarily unavailable while the tool library is migrated",
    };
  }

  return { disabled: false, reason: null };
}

/* -------------------------------------------------------------- the tool rows */

function makeToolEntry({
  discipline,
  sectionId,
  sectionLabel,
  groupId,
  groupLabel,
  tool,
}) {
  return {
    /*
     * A TOOL ID MAY APPEAR IN MORE THAN ONE PLACE - Select in every discipline,
     * Coordinate System in several, Pipe / Duct in Fluids and Thermodynamics.
     * The identity is the full path, so each row states "this tool, here";
     * `toolId` is the tool itself, which is what activation arms.
     */
    id: `tool:${discipline.key}:${sectionId}${groupId ? `:${groupId}` : ""}:${tool.id}`,
    toolId: tool.id,
    type: "tool",
    label: tool.label,
    location: `${discipline.title} > ${sectionLabel}${groupLabel && groupLabel !== sectionLabel ? ` > ${groupLabel}` : ""}`,
    discipline: discipline.key,
    section: sectionLabel,
    group: groupLabel,
    terms: toolTerms(tool.id, tool.label, sectionLabel, groupLabel, discipline),
    shortcut: tool.shortcut || null,
    ...toolStatus(tool.id),
    run: () => activateTool(tool.id, discipline.key, groupId),
  };
}

/*
 * Walk one section. A `submenu: true` entry is a GROUP - a place with tools
 * inside it - so it produces a section row of its own as well as its children.
 */
/* A section row, for a group that is a place rather than a tool. */
function placeRow(discipline, sectionId, sectionLabel, tool, sectionTerms = [], aliases = []) {
  return {
    id: `section:${discipline.key}:${sectionId}:${tool.id}`,
    type: "section",
    label: tool.label,
    location: `${discipline.title} > ${sectionLabel}`,
    discipline: discipline.key,
    section: tool.label,
    /*
     * `opens` is the tool the row EXPANDS, which is the same id: a group parent
     * and its group share one id, because pressing the parent is what opens the
     * group. A row with no tool arms nothing at all.
     */
    opens: tool.id,
    /*
     * `toolId` is filled only where this row IS the toolbar's own row for a
     * tool - a group the toolbar draws inside a section. A section that merely
     * shares a group's name (Process Diagrams, the Coordinate System pair)
     * names no tool, and says so.
     */
    ...(tool.registered ? { toolId: tool.id } : {}),
    terms: [tool.label, sectionLabel, ...sectionTerms, discipline.title, ...aliases],
    shortcut: null,
    disabled: false,
    reason: null,
    run: () => openSection(discipline.key, tool.id),
  };
}

function walkSection({
  discipline,
  sectionId,
  sectionLabel,
  sectionTerms = [],
  tools,
  offerGroups = true,
  offerParents = true,
}) {
  const toolEntries = [];
  const sectionEntries = [];

  (tools || []).forEach((tool) => {
    const group = groupEntries(discipline, sectionId, sectionLabel, tool);
    const children = group ? group.children : null;

    /*
     * A GROUP EVERY SECTION IN THE DISCIPLINE SHARES. A tool id that IS a
     * group's id - `thermodynamic-cycles` sitting inside the Create section
     * with an Analysis section of the same name - is one place: its row is the
     * section, and its TOOLS are listed under that section's name.
     */
    if (COLLIDING_GROUPS.includes(tool.id)) {
      (toolbarChildrenOf(tool.id) || []).forEach((child) => {
        toolEntries.push(
          makeToolEntry({
            discipline,
            sectionId: tool.id,
            sectionLabel: tool.label,
            groupId: tool.id,
            groupLabel: tool.label,
            tool: child,
          }),
        );
      });

      return;
    }

    /*
     * A PARENT THAT ONLY OPENS A GROUP. It is not a tool - pressing it creates
     * nothing - but it IS the row the toolbar draws, so it is indexed as the
     * place its children live. Activation expands it and arms nothing.
     */
    if (!group && offerParents && GROUP_PARENTS.includes(tool.id)) {
      sectionEntries.push(
        placeRow(
          discipline,
          sectionId,
          sectionLabel,
          { ...tool, registered: true },
          sectionTerms,
          ALIASES.sections[tool.id] || [],
        ),
      );

      return;
    }

    if (group && !offerGroups) {
      /* The group's own row would repeat the section's, so only its tools go in. */
      group.children.forEach((child) => {
        toolEntries.push(
          makeToolEntry({
            discipline,
            sectionId,
            sectionLabel,
            groupId: tool.id,
            groupLabel: tool.label,
            tool: child,
          }),
        );

      });

      return;
    }

    if (group) {
      sectionEntries.push(
        placeRow(
          discipline,
          sectionId,
          sectionLabel,
          { ...tool, registered: true },
          sectionTerms,
          ALIASES.sections[tool.id] || [],
        ),
      );

      children.forEach((child) => {
        toolEntries.push(
          makeToolEntry({
            discipline,
            sectionId,
            sectionLabel,
            groupId: tool.id,
            groupLabel: tool.label,
            tool: child,
          }),
        );
      });

      return;
    }

    toolEntries.push(
      makeToolEntry({
        discipline,
        sectionId,
        sectionLabel,
        groupId: null,
        groupLabel: null,
        tool,
      }),
    );
  });

  return { toolEntries, sectionEntries };
}

/* An arc or polygon construction method, as a row under its parent. */
function modeEntries(discipline, sectionId, sectionLabel, tool) {
  const modes =
    tool.id === "arc" || tool.id === "reference-arc"
      ? ARC_MODE_LABELS
      : tool.id === "polygon"
        ? POLYGON_MODE_LABELS
        : [];

  return modes.map((label) => ({
    /*
     * The label is the method's own name, so "3-Point Arc" is a result. It arms
     * the tool in that method through the same arming the toolbar's list uses.
     */
    id: `tool:${discipline.key}:${sectionId}:${tool.id}:${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    toolId: tool.id,
    type: "tool",
    label,
    location: `${discipline.title} > ${sectionLabel}`,
    discipline: discipline.key,
    section: sectionLabel,
    group: tool.label,
    terms: [label, tool.label, "construction method", "method"],
    shortcut: null,
    ...toolStatus(tool.id),
    run: async () => {
      openCategory(discipline.key, null);

      await armCreationMode(tool.id, label);
    },
  }));
}

/*
 * Picking a construction method arms the tool IN THAT METHOD, through the
 * functions the toolbar's own inline list calls.
 */
function armCreationMode(toolId, label) {
  return import("./tool-menus.js").then(
    ({ activateArcMode, activatePolygonMode, ARC_CREATION_MODES, POLYGON_CREATION_MODES }) => {
      if (toolId === "polygon") {
        const mode = POLYGON_CREATION_MODES.find(
          (candidate) => label.toLowerCase().includes(candidate.label.replace("By ", "").toLowerCase()),
        );

        return mode ? activatePolygonMode(mode.id) : undefined;
      }

      const mode = ARC_CREATION_MODES.find(
        (candidate) =>
          label.toLowerCase().includes(candidate.label.replace(" Arc", "").toLowerCase().slice(0, 5)),
      );

      return mode ? activateArcMode(toolId, mode.id) : undefined;
    },
  );
}

/*
 * A FLAT DISCIPLINE's tools. Its list is `engineeringTools[key]` - the very list
 * the toolbar renders - and each label becomes an id through the toolbar's own
 * `drawToolLabelById`, so the id a result arms is the id a click would arm.
 */
function groupEntries(discipline, sectionId, sectionLabel, tool) {
  const children =
    toolbarChildrenOf(tool.id) ||
    (tool.id === "shear-force-diagram" ? analysisModeChildren() : null);

  if (children) {
    return { children, location: `${discipline.title} > ${sectionLabel} > ${tool.label}` };
  }

  if (EXTRA_GROUP_CHILDREN[tool.id]) {
    return {
      children: EXTRA_GROUP_CHILDREN[tool.id],
      location: `${discipline.title} > ${sectionLabel} > ${tool.label}`,
    };
  }

  void sectionId;

  return null;
}

function flatToolEntries(discipline) {
  const labels = engineeringTools[discipline.key] || [];
  const byLabel = new Map(
    Object.entries(drawToolLabelById).map(([id, label]) => [label, id]),
  );

  return labels.map((label) => {
    const toolId =
      byLabel.get(label) || label.toLowerCase().replace(/[^a-z]+/g, "-");

    return {
      id: `tool:${discipline.key}:create:${toolId}`,
      toolId,
      type: "tool",
      label,
      location: `${discipline.title} > Create`,
      discipline: discipline.key,
      section: "Create",
      group: null,
      terms: toolTerms(toolId, label, "Create", null, discipline),
      shortcut: null,
      ...toolStatus(toolId),
      run: () => activateTool(toolId, discipline.key, null),
    };
  });
}

/* ---------------------------------------------------------------- the sections */

/*
 * WHETHER A SECTION IS ITSELF A GROUP.
 *
 * A `submenu: true` parent draws its own heading in its section, so that
 * parent is the SECTION - it needs no second "place" row of its own. A parent
 * that is one entry among several in a section (Bodies, Loads, Flow Paths) is
 * a group INSIDE it, and earns a row of its own.
 */
function isGroupSection(discipline, group) {
  void discipline;

  const tools = group.tools || [];

  return (
    tools.length === 1 &&
    tools[0].submenu === true &&
    Boolean(toolbarChildrenOf(tools[0].id) || EXTRA_GROUP_CHILDREN[tools[0].id])
  );
}

function disciplineEntries() {
  const sections = [];
  const tools = [];

  DISCIPLINES.forEach((discipline) => {
    sections.push({
      id: `section:${discipline.key}:category`,
      type: "section",
      label: discipline.title,
      location: "Toolset",
      discipline: discipline.key,
      section: null,
      terms: [discipline.title, ...discipline.terms],
      shortcut: null,
      disabled: false,
      reason: null,
      run: () => openCategory(discipline.key, null),
    });

    if (!discipline.groups) {
      tools.push(...flatToolEntries(discipline));
      return;
    }

    discipline.groups.forEach((group) => {
      const groupSection = isGroupSection(discipline, group);

      void groupSection;

      sections.push({
        id: `section:${discipline.key}:${group.id}`,
        type: "section",
        label: group.label,
        location: discipline.title,
        discipline: discipline.key,
        section: group.label,
        terms: [
          group.label,
          discipline.title,
          ...(ALIASES.sections[group.id] || []),
        ],
        shortcut: null,
        disabled: false,
        reason: null,
        /*
         * A section that IS a group opens that group, and says which id it is,
         * so a coverage check can tell a place from a category.
         */
        ...(groupSection ? { opens: group.tools[0].id } : {}),
        run: () =>
          openCategory(discipline.key, groupSection ? group.tools[0].id : group.id),
      });

      const walked = walkSection({
        discipline,
        sectionId: group.id,
        sectionLabel: group.label,
        sectionTerms: ALIASES.sections[group.id] || [],
        tools: group.tools,
        /*
         * A SECTION THAT IS ONE GROUP has the parent's id, and the parent row
         * would repeat it, so it is set aside; every other section offers its
         * groups.
         */
        offerParents: !groupSection,
        /*
         * A section that IS a group must not offer its tools behind a second
         * group row: the section row above already says where they are.
         */
        offerGroups: !groupSection,
      });

      tools.push(...walked.toolEntries);
      sections.push(...walked.sectionEntries);

      /* The arc, polygon and reference-arc methods, under their parents. */
      (group.tools || [])
        .filter((tool) => ["arc", "polygon", "reference-arc"].includes(tool.id))
        .forEach((tool) =>
          tools.push(...modeEntries(discipline, group.id, group.label, tool)),
        );
    });
  });

  return { sections, tools };
}

/* ------------------------------------------------------------------- the menus */

/*
 * THE MENU TREE, FLATTENED.
 *
 * Every menu item with a `run` becomes a command: Undo, Print, the visibility
 * toggles, draw order, the file commands and the modify tools are all findable
 * with no list of their own. A nested item (Download > PDF) carries its
 * parent's name in its label and location, so "download pdf" finds it.
 *
 * A command with nothing to act on is STILL LISTED - it is a real command, and
 * the student may be looking for it - but it carries the menu's own reason, and
 * activating it explains rather than running.
 */
function commandEntries() {
  const entries = [];

  MENUS.forEach((menu) => {
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

        if (typeof item.run !== "function") {
          return;
        }

        const label = parent ? `${parent.label} > ${item.label}` : item.label;

        entries.push({
          /*
           * A NESTED ITEM KEEPS ITS PARENT IN THE PATH, so Download > PDF is
           * `file:download:download-pdf` and cannot collide with a top-level
           * `download-pdf` some other menu may grow later.
           */
          id: `command:${definition.id}:${parent ? `${parent.id}:` : ""}${item.id}`,
          parent: parent ? parent.id : null,
          type: "command",
          label,
          location: parent
            ? `${definition.label} > ${parent.label}`
            : definition.label,
          menu: definition.label,
          terms: commandTerms(item.id, label, definition),
          shortcut: item.shortcut || null,
          disabled: item.disabled === true,
          reason:
            item.disabled === true
              ? item.disabledReason || "Not available right now"
              : null,
          run: item.run,
        });
      });
    };

    walk(definition.items, null);
  });

  return entries;
}

/* ------------------------------------------------------------------ the panels */

/*
 * THE PANEL'S DESTINATIONS: its three tabs, and the Source tab's own toolbar
 * buttons. The buttons are read from the markup, so a source tool added there
 * is findable with no edit here - and one removed stops being reported.
 */
function panelEntries() {
  const entries = [
    {
      id: "panel:objects",
      type: "panel",
      label: "Objects",
      location: "Drawing panel",
      terms: [
        "Objects",
        "object list",
        "inventory",
        "named objects",
        "what is on the sheet",
        "what has been drawn",
      ],
      note: "Lists everything on the active sheet",
      shortcut: null,
      disabled: false,
      reason: null,
      run: () => openPanelTab("objects"),
    },
    {
      id: "panel:features",
      type: "panel",
      label: "Features",
      location: "Drawing panel",
      terms: [
        "Features",
        "properties",
        "inspector",
        "edit object",
        "settings of the selection",
        "attributes",
        "colour",
        "color",
      ],
      note: "Shows the properties of the selected object",
      shortcut: null,
      disabled: false,
      reason: null,
      run: () => openPanelTab("features"),
    },
    {
      id: "panel:source",
      type: "panel",
      label: "Source",
      location: "Drawing panel",
      terms: [
        "Source",
        "latex",
        "tikz",
        "code",
        "generated source",
        "open source",
        "edit the code",
        "source code",
      ],
      note: "The LaTeX/TikZ source that generates the drawing",
      shortcut: null,
      disabled: false,
      reason: null,
      run: () => openPanelTab("source"),
    },
  ];

  sourceToolButtons().forEach((button) => {
    const label = (button.getAttribute("aria-label") || button.textContent || "")
      .replace(/\s+/g, " ")
      .trim();

    if (!label) {
      return;
    }

    const action =
      button.dataset.sourceAction ||
      label.toLowerCase().replace(/[^a-z]+/g, "-");

    entries.push({
      id: `panel:source:${action}`,
      type: "panel",
      label,
      location: "Drawing panel > Source",
      terms: [label, "Source", "source tool", "latex source"],
      note: "A Source tab control",
      shortcut: null,
      disabled: button.disabled === true,
      reason: null,
      run: async () => {
        await openPanelTab("source");

        sourceToolButtons()
          .find((candidate) => candidate.dataset.sourceAction === action)
          ?.click();
      },
    });
  });

  return entries;
}

function sourceToolButtons() {
  const doc = globalThis.document;

  return doc ? [...doc.querySelectorAll("[data-source-action]")] : [];
}

/* ------------------------------------------------------------ view destinations */

/*
 * THE WORKSPACE DESTINATIONS.
 *
 * Each is a real focus target, not a mode: the search rings the place it names
 * and does nothing else, because a result that changed a panel's state would be
 * a second way of changing it.
 */
const VIEW_ENTRIES = [
  {
    id: "view:toolset",
    label: "Toolset bar",
    terms: [
      "Toolset bar",
      "tools",
      "toolbar",
      "tool list",
      "categories",
      "sections",
      "left panel of tools",
    ],
    note: "The category bar and the tool list on the left",
    find: (doc) => doc.querySelector("#drawingToolList") || doc.querySelector(".drawing-tool-list"),
  },
  {
    id: "view:sheet-tabs",
    label: "Sheets",
    terms: [
      "Sheets",
      "sheet tabs",
      "new sheet",
      "add a sheet",
      "page",
      "pages",
      "drawing sheet",
      "another sheet",
    ],
    note: "The sheet tabs above the canvas",
    find: (doc) => doc.querySelector("#drawingSheetTabs") || doc.querySelector(".drawing-sheet-tabs"),
  },
];

function viewEntries() {
  return VIEW_ENTRIES.map((entry) => ({
    id: entry.id,
    type: "view",
    label: entry.label,
    location: "Workspace",
    terms: entry.terms,
    note: entry.note,
    shortcut: null,
    disabled: false,
    reason: null,
    run: () => reveal(entry.find),
  }));
}

/* Ring the place a result named, briefly, without taking the keyboard. */
function reveal(find) {
  const doc = globalThis.document;
  const target = doc ? find(doc) : null;

  if (!target) {
    return false;
  }

  target.classList.add("datum-search-reveal");

  globalThis.setTimeout?.(() => target.classList.remove("datum-search-reveal"), 1400);

  return true;
}

/* ---------------------------------------------------------------- the registry */

/*
 * ============================================================
 * REGISTERED, BUT NOT IN A TOOL SECTION
 * ============================================================
 *
 * The tool-library registry describes the LIBRARY's intended hierarchy, and a
 * handful of its entries describe tools the interface does not yet offer: a
 * Pipe and a Reservoir in Fluids, Velocity and Motion Path in Dynamics, a few
 * Thermodynamics symbols. They are real entries with real folders, and a
 * student may know their names - so they are findable, and they say plainly
 * that they are not in a tool section. They are never offered as something to
 * activate, because there is nothing to activate.
 *
 * MATCHING IS BY LABEL WITHIN THE DISCIPLINE. An entry whose label is offered
 * somewhere in the same discipline is the same tool under a different id and is
 * NOT repeated. That is what stops this section inventing duplicates, and what
 * makes it shrink to nothing as the interface catches up with the library.
 */
function registryOnlyEntries(index) {
  const offered = new Set(
    index
      .filter((entry) => entry.type === "tool")
      .map((entry) => `${entry.discipline}:${entry.label.toLowerCase()}`),
  );

  /*
   * AND THE TOOLS THE TOOLSET BAR HOLDS OUTSIDE A DISCIPLINE. Move, Rotate,
   * Mirror, Trim, Extend, Pan, Zoom and Fit live on the View and Modify commands
   * (and in the Geometry library's own folders), and a registry entry repeating
   * one of them would be a second row for a tool that is already offered.
   *
   * A GROUP'S NAME COUNTS TOO. The library registry calls a whole Process
   * Diagrams frame one tool, while the interface offers four drawings of that
   * kind under the heading "Process Diagrams"; Heat Transfer and Work are the
   * same case. The heading is what the student is looking for, and it is
   * already a row of its own - so the registry entry repeats it, and is not
   * offered a second time under the library's heading.
   */
  [
    ...Object.values(drawToolLabelById),
    ...DISCIPLINES.flatMap((discipline) => (discipline.groups || []).map((group) => group.label)),
  ].forEach((label) => {
    offered.add(`*:${label.toLowerCase()}`);
  });

  const entries = [];

  registry.categories().forEach((category) => {
    const discipline = DISCIPLINES.find(
      (candidate) => candidate.key === String(category.label || "").toUpperCase(),
    );

    if (!discipline) {
      return;
    }

    const walk = (node) => {
      (node?.tools || []).forEach((entry) => {
        if (entry.kind !== "tool" || !entry.label) {
          return;
        }

        const key = `${discipline.key}:${entry.label.toLowerCase()}`;

        if (offered.has(key) || offered.has(`*:${entry.label.toLowerCase()}`)) {
          return;
        }

        offered.add(key);

        entries.push({
          id: `registry:${entry.id}`,
          type: "tool",
          label: entry.label,
          location: `${discipline.title} > Tool library`,
          discipline: discipline.key,
          section: "Tool library",
          terms: [discipline.title, "tool library"],
          shortcut: null,
          disabled: true,
          reason:
            "In the tool library, but not offered in a tool section of this interface yet",
          run: null,
        });
      });

      (node?.groups || []).forEach(walk);
      (node?.subgroups || []).forEach(walk);
    };

    (category.groups || []).forEach(walk);
  });

  return entries;
}

/* -------------------------------------------------------------------- aliases */

/*
 * THE WORDS PEOPLE TYPE THAT ARE NOT ON A BUTTON.
 *
 * Each alias names a TERM and the entry it belongs to, by that entry's id. The
 * terms are attached to the entry, never added as entries of their own, so a
 * result still reads as the real tool or command and still runs it.
 *
 * THESE ARE NOT A TOOL LIST. Nothing here creates a tool, a section or a
 * command: a target that is not in the derived index is dropped.
 */
const ALIASES = {
  entries: [
    /* Settings, reached through the commands that open them. */
    {
      target: "command:tools:drawing-settings",
      terms: ["dark mode", "dark", "light mode", "theme", "appearance", "colour scheme", "color scheme"],
    },
    {
      target: "command:tools:drawing-settings",
      terms: ["units", "millimetres", "millimeters", "precision", "paper size", "drawing scale"],
    },
    {
      target: "command:tools:precision",
      terms: ["snapping", "snap sensitivity", "snap targets", "inference", "grid snap"],
    },
    {
      target: "command:tools:measure-distance",
      terms: ["measure distance", "measurement", "measure", "measure length", "ruler"],
    },
    {
      target: "command:tools:measure-angle",
      terms: ["measure angle", "protractor", "angle measurement"],
    },
    {
      target: "command:tools:inspect",
      terms: ["inspect", "inspection", "selected feature", "info", "what is this feature"],
    },
    {
      target: "command:tools:shortcuts",
      terms: ["shortcuts", "keyboard", "hotkeys", "keys", "key bindings"],
    },

    /* File. */
    { target: "command:file:new", terms: ["new drawing", "new file", "blank sheet", "start again"] },
    { target: "command:file:open", terms: ["open", "open file", "open a drawing", "load"] },
    { target: "command:file:save", terms: ["save", "store", "save file"] },
    { target: "command:file:save-as", terms: ["save as", "save a copy", "export"] },
    { target: "command:file:print", terms: ["print", "printer", "output", "print the drawing"] },
    {
      target: "command:file:download:download-pdf",
      terms: ["download pdf", "export pdf"],
    },
    {
      target: "command:file:download:download-png",
      terms: ["download png", "export png", "picture"],
    },
    {
      target: "command:file:download:download-jpg",
      terms: ["download jpg", "export jpg", "picture"],
    },
    {
      target: "command:file:download:download-latex",
      terms: ["latex picture", "export latex"],
    },
    {
      target: "command:file:download:download-drawing",
      terms: ["editable file", "desktop file", "save a copy to disk"],
    },

    /* Edit. */
    { target: "command:edit:undo", terms: ["undo", "step back", "reverse"] },
    { target: "command:edit:redo", terms: ["redo", "put it back"] },
    { target: "command:edit:cut", terms: ["cut", "remove selection"] },
    { target: "command:edit:copy", terms: ["copy", "copy selection"] },
    { target: "command:edit:paste", terms: ["paste", "insert clipboard"] },
    { target: "command:edit:select-all", terms: ["select all", "everything", "all objects"] },
    { target: "command:edit:delete", terms: ["delete", "remove", "erase", "clear"] },

    /* View and visibility. */
    { target: "command:view:pan", terms: ["pan", "scroll", "move view", "hand"] },
    { target: "command:view:zoom-in", terms: ["zoom", "zoom in", "magnify", "closer", "bigger"] },
    { target: "command:view:zoom-out", terms: ["zoom out", "further away", "smaller"] },
    { target: "command:view:fit", terms: ["fit", "zoom to fit", "fit to screen", "fit all", "show everything"] },
    {
      target: "command:view:grid",
      terms: [
        "grid",
        "show grid",
        "hide grid",
        "grid lines",
        "hide object",
        "show hidden object",
        "hide something",
        "make invisible",
        "make visible",
      ],
    },
    {
      target: "command:view:dimensions",
      terms: [
        "dimensions",
        "show dimensions",
        "hide dimensions",
        "hide measurements",
        "show measurements",
      ],
    },
    {
      target: "command:view:magnitudes",
      terms: [
        "magnitudes",
        "show magnitudes",
        "values on arrows",
        "hide values",
        "show values",
      ],
    },
    {
      /* Changing an object's colour is done in its Features panel. */
      target: "panel:features",
      terms: [
        "change colour",
        "change color",
        "change the colour",
        "change the color",
        "line colour",
        "stroke colour",
      ],
    },

    /* Insert. */
    { target: "command:insert:text-box", terms: ["text box", "add text", "writing"] },
    { target: "command:insert:latex-code", terms: ["latex code", "edit the latex", "raw code"] },

    /* Tools the menu holds. */
    { target: "command:tools:rotate", terms: ["rotate", "turn", "rotation tool"] },
    { target: "command:tools:move", terms: ["move", "shift", "displace"] },
    { target: "command:tools:mirror", terms: ["mirror", "reflect"] },
    { target: "command:tools:trim", terms: ["trim", "cut back", "shorten"] },
    { target: "command:tools:extend", terms: ["extend", "lengthen"] },
    { target: "command:tools:order-front", terms: ["bring to front", "draw on top", "front"] },
    { target: "command:tools:order-back", terms: ["send to back", "draw behind", "behind"] },
    { target: "command:tools:format-source", terms: ["format source", "tidy the code", "indent"] },

    /* Destinations. */
    { target: "view:sheet-tabs", terms: ["new sheet", "add a sheet", "another page"] },
    { target: "panel:source", terms: ["open source", "open code", "show the latex"] },
    { target: "panel:objects", terms: ["what has been drawn", "list of objects"] },
  ],

  /*
   * Extra words for a tool id WHEREVER IT APPEARS. Coordinate System is in four
   * sections and means the same thing in each, so its synonyms are stated once.
   */
  tools: {
    "pipe-duct": [
      "pipe",
      "duct",
      "piping",
      "pipe run",
      "pipework",
      "tube",
      "change pipe width",
      "pipe width",
      "duct width",
      "pipe size",
      "run width",
    ],
    elbow: ["bend", "pipe bend", "fitting", "corner", "bend radius", "elbow radius"],
    junction: ["tee", "t-junction", "branch", "fitting"],
    "reducer-expander": ["reducer", "expander", "taper", "fitting"],
    "reservoir-tank": ["reservoir", "tank", "vessel", "cistern"],
    pump: ["pump", "equipment"],
    valve: ["valve", "equipment"],
    "flow-meter": ["meter", "flowmeter", "gauge", "measure flow"],
    "flow-arrow": ["flow", "arrow", "direction arrow", "flow direction", "flow direction indicator"],
    "fluid-level": ["fluid level", "level", "surface", "liquid level", "fluid surface"],
    "flow-direction-diagram": ["flow direction", "direction diagram", "flow arrows"],
    "flow-profile": ["flow profile", "velocity profile", "profile graph"],
    "pressure-profile": ["pressure profile", "pressure graph", "profile graph"],
    "section-plane": ["section line", "cut line", "section marker"],
    particle: ["particle", "point mass", "dot"],
    "rigid-body": ["rigid body", "body", "block"],
    beam: ["beam", "member", "bar"],
    truss: ["truss", "framework", "triangulated structure"],
    cable: ["cable", "rope", "cord"],
    shaft: ["shaft", "rod", "axle"],
    "point-force": ["point load", "force", "arrow", "vector", "applied force"],
    moment: ["moment", "torque", "couple"],
    "distributed-load": ["distributed load", "udl", "uniform load"],
    "varying-distributed-load": ["varying load", "triangular load", "uvl", "changing load"],
    "pin-support": ["pin", "hinge", "pinned support"],
    "roller-support": ["roller", "roller support", "wheels"],
    "fixed-support": ["fixed end", "cantilever", "built in", "encastre"],
    "smooth-support": ["smooth support", "frictionless support"],
    "pin-connection": ["pin joint", "hinge connection"],
    "fixed-connection": ["rigid joint", "fixed joint"],
    "slider-connection": ["slider", "sliding joint"],
    resultant: ["resultant", "sum of forces", "combine forces"],
    "force-components": ["components", "resolve a force", "split a force", "fx fy"],
    "shear-force-diagram": ["sfd", "shear", "shear force diagram"],
    "bending-moment-diagram": ["bmd", "bending moment", "moment diagram"],
    "axial-force-diagram": ["afd", "axial force", "normal force"],
    dimension: ["dimension", "measure size", "measurement"],
    note: ["note", "text", "text box", "writing"],
    label: ["label", "tag", "name"],
    leader: ["leader", "leader line", "pointer"],
    callout: ["callout", "speech bubble", "note bubble"],
    table: ["table", "rows and columns", "grid of values"],
    select: ["select", "pick", "choose"],
    point: ["point", "node"],
    line: ["line", "straight line", "draw a line"],
    polyline: ["polyline", "chain of lines"],
    triangle: ["triangle"],
    rectangle: ["rectangle", "box", "square"],
    circle: ["circle", "round"],
    arc: ["arc", "curve", "circular arc"],
    polygon: ["polygon", "many-sided shape"],
    "freeform-polygon": ["freeform", "free form", "hand drawn shape"],
    "coordinate-system": ["axes", "origin", "coordinate", "cs", "datum axes"],
    "coordinate-system-2d": ["axes", "origin", "coordinate", "cs", "2d axes"],
    "coordinate-system-3d": ["3d axes", "three dimensional"],
    move: ["move", "shift"],
    rotate: ["rotate", "turn"],
    mirror: ["mirror", "reflect"],
    trim: ["trim", "cut back"],
    extend: ["extend", "lengthen"],
    pan: ["pan", "scroll"],
    zoom: ["zoom", "magnify"],
    fit: ["fit", "fit to screen"],
    "reference-point": ["reference point", "datum point", "anchor"],
    "reference-line": ["reference line", "construction line", "datum line"],
    "reference-arc": ["reference arc", "construction arc"],
    "dynamics-particle": ["particle", "point mass"],
    "dynamics-rigid-body": ["rigid body", "body"],
    "dynamics-polar-vector": ["polar", "vector", "direction vector"],
    "dynamics-angular-vector": ["angular", "rotation vector", "angular velocity"],
    "dynamics-spring": ["spring", "stiffness"],
    "dynamics-damper": ["damper", "dashpot", "viscous damper"],
    "dynamics-spring-damper": ["spring damper", "mass spring damper"],
    "dynamics-pulley": ["pulley", "rope and wheel"],
    "steady-state-devices": ["steady state", "devices", "turbine", "compressor"],
    "turbine-compressor": ["turbine", "compressor"],
    "nozzle-diffuser": ["nozzle", "diffuser"],
    tank: ["tank", "vessel"],
    "control-volume": ["control volume", "system boundary"],
    "piston-cylinder": ["piston", "cylinder"],
    "piston-cylinder-stoppers": ["piston", "cylinder", "stoppers"],
    "process-diagrams": ["process diagram", "pv diagram", "ts diagram"],
    "process-plot": ["process plot", "plot", "axes"],
    "saturation-curve": ["saturation curve", "saturation"],
    "process-path": ["process path", "state path"],
    "constant-temp-pressure-lines": ["isobar", "isotherm", "constant pressure", "constant temperature"],
    "thermodynamic-cycles": ["cycles", "thermodynamic cycle"],
    "rankine-cycle": ["rankine"],
    "reheat-rankine-cycle": ["reheat rankine", "rankine"],
    "brayton-cycle": ["brayton", "joule cycle"],
    "otto-cycle": ["otto"],
    "diesel-cycle": ["diesel"],
    "carnot-cycle": ["carnot"],
    "vapor-compression-cycle": ["vapor compression", "refrigeration"],
    "heat-transfer": ["heat transfer", "conduction", "heat"],
    "heat-entering": ["heat entering", "heat in", "q in"],
    "heat-leaving": ["heat leaving", "heat out", "q out"],
    work: ["work"],
    "work-arrow": ["work arrow", "work"],
    "electric-work": ["electrical work"],
    "mechanical-work": ["mechanical work"],
    wall: ["wall"],
    layer: ["layer"],
    "heat-flux": ["heat flux", "flux"],
    temperature: ["temperature", "temp"],
    convection: ["convection"],
    radiation: ["radiation"],
    "stress-element": ["stress element", "stress"],
    "boundary-stress": ["boundary stress", "plate stress"],
    support: ["support", "supports"],
    load: ["load", "loads"],
    part: ["part"],
    hole: ["hole"],
    gear: ["gear", "cog"],
    fastener: ["fastener", "bolt", "screw"],
    "section-view": ["section view", "cutaway"],
    plant: ["plant", "process"],
    block: ["block"],
    input: ["input"],
    output: ["output"],
    sensor: ["sensor"],
    controller: ["controller"],
    "signal-line": ["signal line", "signal"],
    "signal-arrow": ["signal arrow"],
    function: ["function"],
    vector: ["vector"],
    graph: ["graph", "plot"],
    equation: ["equation", "formula"],
    gain: ["gain", "amplifier"],
    sum: ["sum", "summing junction", "adder"],
  },

  /*
   * EXTRA WORDS FOR THE SETTINGS A FEATURE OFFERS.
   *
   * Reading the document already gives the search every feature on the sheet
   * and every setting its panel shows. What it cannot give is what a student
   * might CALL those settings - "pipe width" for a run's Width, "angle" for a
   * bend's Angle. Each group here adds those words to any feature setting whose
   * key is in the list, wherever that setting is offered.
   */
  featureSettings: {
    width: ["pipe width", "change pipe width", "duct width", "run width", "thickness", "make it wider", "make it narrower"],
    height: ["height", "tall", "make it taller"],
    angle: ["angle", "rotate", "rotation", "tilt", "bend angle"],
    radius: ["radius", "bend radius", "elbow radius", "curve"],
    colour: ["colour", "color", "change colour", "change color", "line colour", "stroke"],
    lineType: ["line type", "dashed", "dotted", "construction line", "line style"],
    lineWidth: ["line weight", "thickness", "line width", "stroke width"],
    name: ["name", "rename", "label"],
    text: ["text", "label", "caption", "writing"],
    direction: ["direction", "flow direction", "point it the other way"],
    label: ["label", "name"],
  },

  /* Extra words for a section, beyond its own name. */
  sections: {
    body: ["bodies", "particles", "beams", "trusses", "cables"],
    load: ["loads", "forces", "applied loads"],
    support: ["supports", "restraints", "reactions"],
    connection: ["connections", "joints"],
    "fluids-flow-paths": ["flow paths", "pipework", "pipes", "pipe", "runs", "fittings"],
    "fluids-flow-indicators": ["flow indicators", "arrows", "level"],
    "dynamics-bodies": ["bodies", "particles"],
    "dynamics-kinematics": ["kinematics", "motion"],
    "dynamics-mechanical": ["mechanical elements", "springs", "dampers", "pulleys"],
    "steady-state-devices": ["devices", "equipment"],
    "thermodynamic-cycles": ["cycles"],
    "process-diagrams": ["process diagrams"],
    "piston-cylinder": ["piston"],
    work: ["work"],
    "heat-transfer": ["heat transfer", "heat"],
    "coordinate-system": ["axes"],
  },
};

/*
 * WHICH WORD A FIELD'S KEY IS ABOUT.
 *
 * The panel's keys are specific - `pipeWidth`, `lineWidth`, `bendRadius` - and
 * the search's synonym groups are general. `widthFamilyOf("pipeWidth")` is
 * "width", so the pipe's own Width answers to the same words a plain Width
 * does; an unknown key answers only to itself.
 */
function widthFamilyOf(key) {
  const known = Object.keys(ALIASES.featureSettings);

  /* `lineWidth` is thickness, not width: it is matched by its own entry. */
  if (key === "lineWidth") {
    return "lineWidth";
  }

  return (
    known.find(
      (family) =>
        family !== key &&
        key.toLowerCase().endsWith(family.toLowerCase()) === true,
    ) || key
  );
}

/* The terms attached to a tool row: its name, its place, and its synonyms. */
function toolTerms(toolId, label, sectionLabel, groupLabel, discipline) {
  const terms = new Set([label, sectionLabel, discipline.title]);

  if (groupLabel) {
    terms.add(groupLabel);
  }

  (ALIASES.tools[toolId] || []).forEach((term) => terms.add(term));

  return [...terms];
}

/* Command synonyms that are not on the menu item's face. */
function commandTerms(itemId, label, menu) {
  const extra = {
    "format-source": ["tidy code", "indent", "format"],
    "order-front": ["bring to front", "top"],
    "order-forward": ["bring forward", "up one"],
    "order-backward": ["send backward", "down one"],
    "order-back": ["send to back", "bottom"],
    undo: ["step back"],
    redo: ["step forward"],
    "move-to-trash": ["delete the document", "bin"],
    rename: ["name the document", "title"],
    details: ["document information", "metadata"],
  };

  return [label, menu.label, ...(extra[itemId] || [])];
}

/* ------------------------------------------------------- the features on the sheet */

/*
 * ============================================================
 * THE FEATURES ALREADY DRAWN - AND THE SETTINGS THEY OFFER
 * ============================================================
 *
 * A student looking for "change pipe width" is not looking for a tool to draw
 * another pipe; they are looking for the Width row of the pipe they can see.
 * The same is true of "elbow radius", "hide object", "change colour".
 *
 * This is not a tool list and cannot become one: every entry is read from the
 * DOCUMENT at the moment the search runs, so an object deleted stops being
 * searchable, an object added is searchable at once, and a setting a feature
 * does not offer is never offered by the search.
 *
 * WHAT EACH ROW DOES:
 *
 *   a FEATURE      selects that object and opens its Features panel - the same
 *                  selection a click on the canvas makes, so the Features panel,
 *                  the canvas highlight and the status line cannot disagree
 *   a SETTING      does the same, then puts the cursor in that field - so the
 *                  student arrives at the control that was named, ready to type
 *
 * NOTHING IS SET BY A SEARCH. A setting row does not change a value; it opens
 * the place the value is changed. A result that silently edited the drawing
 * would be worse than no result at all.
 *
 * NO SELECTION IS REQUIRED TO FIND ONE. "Pipe width" is discoverable on a sheet
 * with five pipes and nothing selected; selecting the result is what picks the
 * pipe, and with several of that type drawn they are all offered, by name.
 */

/*
 * The panel's field key, read the way the Features pane reads it: a field is
 * `{ key, definition }`, and the key is what the pane writes to.
 */
function settingKeyOf(field) {
  if (typeof field === "string") {
    return field;
  }

  return field?.key || field?.field || field?.id || null;
}

/*
 * A field's own name, asked of the schema - so a search row reads "Line Style",
 * the words the panel prints, rather than the internal key "lineType".
 */
function settingLabelOf(field) {
  const key = settingKeyOf(field);
  const definition = (typeof field === "object" && field.definition) || {};

  try {
    /*
     * THE SCHEMA'S OWN READER, given the field and its key exactly as the pane
     * gives them - so a result says "Line Style" where the panel says "Line
     * Style", and never exposes an internal key to the student.
     */
    return featureSchema.fieldLabel?.(definition, key) || titleCase(key || "");
  } catch {
    return titleCase(String(key || "").replace(/([a-z])([A-Z])/g, "$1 $2"));
  }
}

/*
 * The feature rows for the document as it stands. `groupsFor` and the object
 * type label come from the Features schema, imported lazily: the schema is a
 * leaf module, but it is only needed when there is something drawn.
 */
function featureEntries(disciplineByLabel) {
  const objects = Array.isArray(drawingState?.objects) ? drawingState.objects : [];

  return objects.flatMap((object) => {
    const label = safeLabel(object);

    if (!label) {
      return [];
    }

    const where = placeOf(object, disciplineByLabel);
    const terms = new Set([label, where, "feature", "object", "on the sheet"]);

    const rows = [
      {
        id: `feature:${object.id}`,
        type: "feature",
        label,
        location: where,
        objectId: object.id,
        terms: [...terms],
        shortcut: null,
        disabled: false,
        reason: null,
        run: () => selectFeature(object.id)
      },
    ];

    (safeGroups(object) || []).forEach((group) => {
      (group?.fields || group?.settings || []).forEach((field) => {
        const key = settingKeyOf(field);
        const fieldLabel = settingLabelOf(field);

        if (!key || !fieldLabel) {
          return;
        }

        rows.push({
          /* `key` is the panel's own field key; the search never invents one. */
          id: `feature:${object.id}:${key}`,
          type: "feature",
          kind: "setting",
          label: `${label} - ${fieldLabel}`,
          location: where,
          objectId: object.id,
          setting: key,
          settingLabel: fieldLabel,
          terms: [
            fieldLabel,
            label,
            where,
            "setting",
            "property",
            "change",
            /*
             * The words for this setting, from the GENERIC group (a Width) and
             * from the field's own key (`pipeWidth`) - so "pipe width" reaches
             * the pipe's own Width and not only a generic one.
             */
            ...(ALIASES.featureSettings[key] || []),
            ...(ALIASES.featureSettings[widthFamilyOf(key)] || [])
          ],
          shortcut: null,
          disabled: false,
          reason: null,
          run: () => openFeatureSetting(object.id, key)
        });
      });
    });

    return rows;
  });
}

/*
 * The object's display name, asked of the schema's own reader so a search
 * result is called what the Features panel and the Objects list call it.
 */
function safeLabel(object) {
  try {
    return featureSchema.displayNameOf?.(object) || object.name || null;
  } catch {
    return object.name || null;
  }
}

/* The groups of settings the panel would show, or none. */
function safeGroups(object) {
  try {
    return featureSchema.groupsFor?.(object) || [];
  } catch {
    return [];
  }
}

/*
 * WHERE THE FEATURE LIVES, in the words of the interface: the discipline it was
 * drawn in, then "On the sheet". A feature whose discipline is not one the
 * toolbar lists is still placed - it is simply not given a false one.
 */
function placeOf(object, disciplineByLabel) {
  const discipline = object?.engineering?.discipline;

  if (typeof discipline === "string" && discipline) {
    return `On the sheet > ${disciplineByLabel.get(discipline.toLowerCase()) || titleCase(discipline)}`;
  }

  return "On the sheet";
}

function titleCase(value) {
  return String(value)
    .replace(/-/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

/*
 * SELECTING A FEATURE IS THE SAME ACT AS CLICKING IT.
 *
 * `selectObjects` is the model's own selection, and the Features panel follows
 * the `datum:selection-changed` announcement the model raises - so this is the
 * selection the canvas would make, not a second idea of "selected".
 */
async function selectFeature(objectId) {
  const { drawingState } = await import("../../../features/workspace/editor-state.js");
  const model = (await import("../../../shared/model/drawing-state.js")).default;

  await openPanelTab("features");

  if (!drawingState.objects.some((object) => object.id === objectId)) {
    return;
  }

  model.setActiveTool(drawingState, "select");
  model.selectObjects(drawingState, [objectId]);

  const { renderCurrentDrawing } = await import("../workspace/canvas-render.js");

  renderCurrentDrawing();
}

/*
 * OPENING A SETTING: the feature first, then the field itself is focused.
 *
 * The pane renders synchronously when the tab opens, so the field is on the page
 * by the time the selection is made. Two frames are allowed for that render, and
 * the field is found by the key the pane gave it - if it is not there (the
 * panel is collapsed, the feature offers it only somewhere else) the selection
 * still stands and nothing is pretended.
 */
async function openFeatureSetting(objectId, key) {
  await selectFeature(objectId);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const field = findFeatureField(key);

    if (field) {
      field.scrollIntoView?.({ block: "nearest" });
      field.focus?.();

      if (typeof field.select === "function") {
        field.select();
      }

      return;
    }

    await new Promise((resolve) => globalThis.setTimeout?.(resolve, 0));
  }
}

/*
 * WHERE A SETTING'S CONTROL IS.
 *
 * Most settings are a plain Features field. A few are edited by a control of
 * their own - a pipe's Width is the Transform section's `width` box, because
 * that is where the pane really offers it - so the key is mapped to the control
 * that carries it rather than looked up by its schema name alone.
 */
const SETTING_CONTROLS = {
  pipeWidth: '[data-transform-input="width"]',
  wallThickness: '[data-transform-input="width"]'
};

function findFeatureField(key) {
  const doc = globalThis.document;

  if (!doc) {
    return null;
  }

  return (
    (SETTING_CONTROLS[key] ? doc.querySelector(SETTING_CONTROLS[key]) : null)
    || doc.querySelector(`[data-feature-field="${key}"]`)
    || doc.querySelector(`[data-feature-choice="${key}"][aria-checked="true"]`)
    || null
  );
}

/* -------------------------------------------------------------------- the index */

/*
 * THE COMPLETE INDEX, rebuilt on demand.
 *
 * Built rather than cached because what it reads moves: a command is disabled
 * until there is something to undo, and a cached catalogue would let the search
 * run what the menu would have greyed out. It is a few hundred small objects,
 * so there is nothing to gain by caching and a correctness risk in it.
 */
export function buildSearchIndex() {
  const { sections, tools } = disciplineEntries();

  const disciplineByLabel = new Map(
    DISCIPLINES.map((discipline) => [discipline.key.toLowerCase(), discipline.title]),
  );

  const index = [
    ...tools,
    ...sections,
    ...commandEntries(),
    ...panelEntries(),
    ...viewEntries(),
    /*
     * THE FEATURES ON THE SHEET, LAST. They are read from the document, so they
     * change as the student draws; being last means a query naming a TOOL is
     * answered by the tool first and the drawings made with it second.
     */
    ...featureEntries(disciplineByLabel),
  ];

  const byId = new Map(index.map((entry) => [entry.id, entry]));

  ALIASES.entries.forEach((alias) => {
    const target = byId.get(alias.target);

    if (!target) {
      /* The thing an alias names is not offered, so the alias goes with it. */
      return;
    }

    byId.set(target.id, {
      ...target,
      terms: [...new Set([...target.terms, ...alias.terms])],
    });
  });

  return [...byId.values()];
}

/* The whole index, including the library entries no section offers. */
export function searchIndex() {
  const index = buildSearchIndex();

  return [...index, ...registryOnlyEntries(index)];
}

/*
 * The tool rows alone, in the order the toolbar arranges them. Used by the
 * coverage test and by anything that needs the arrangement rather than a query.
 */
export function toolsetRows() {
  return buildSearchIndex().filter((entry) => entry.type === "tool");
}

/* --------------------------------------------------------- navigation handlers */

/*
 * Open a category, and optionally a group inside it, WITHOUT arming a tool.
 *
 * The category's own click is used, so the tool reset, the preview clearing and
 * the re-render are the application's own - not a quieter second version of
 * them. A group is expanded the way a student expands it: by clicking its
 * button, so the toolbar's own state and the DOM cannot disagree.
 */
export function openCategory(discipline, groupId = null) {
  const button = globalThis.document?.querySelector(
    `.drawing-category[data-category="${discipline}"]`,
  );

  if (!button) {
    return false;
  }

  if (!button.classList.contains("active")) {
    button.click();
  }

  if (groupId) {
    expandGroup(groupId);
  }

  return true;
}

/* A section result opens its place and arms nothing - the tools are the choice. */
export function openSection(discipline, groupId) {
  return openCategory(discipline, groupId);
}

function expandGroup(groupId) {
  const doc = globalThis.document;

  if (!doc) {
    return;
  }

  const button = [...doc.querySelectorAll(".drawing-tool[data-tool-id]")].find(
    (candidate) => candidate.dataset.toolId === groupId,
  );

  if (button && button.getAttribute("aria-expanded") === "false") {
    button.click();
  }
}

export { ALIASES, DISCIPLINES, ARC_MODE_LABELS, POLYGON_MODE_LABELS };

export default {
  buildSearchIndex,
  searchIndex,
  toolsetRows,
  openCategory,
  openSection,
};
/*
 * ============================================================
 * DECLARATIVE-ENTRY NOTES
 * ============================================================
 *
 * 1. FLAT DISCIPLINES.
 *
 * Heat Transfer, Mechanical Design, Controls and Math / Analysis have no
 * section list: the toolbar renders `engineeringTools[key]` as one flat list.
 * Their rows are built from that same list (`flatToolEntries`), so a label the
 * toolbar stops showing stops being a result.
 *
 * 2. SECTION IDS.
 *
 * A section's id is `section:<discipline>:<group id>`, and a group inside a
 * section adds its own id to the path. Nothing else about a section is stored,
 * so a renamed section is found by its new name and a removed one leaves no
 * trace.
 */

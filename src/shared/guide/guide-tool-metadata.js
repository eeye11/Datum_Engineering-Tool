/*
 * ============================================================
 * THE USER GUIDE'S VIEW OF THE TOOL REGISTRY
 * ============================================================
 *
 * The guide shows a tool's name, its shortcut, the gesture it takes and the
 * words the status line uses when it is armed. NONE of those facts are typed
 * here. Each one is asked of the module that already decides it:
 *
 *   names, groups, shortcuts   the toolbar's own tables (`tools.js`, the four
 *                              discipline registries, the Math section)
 *   the opening instruction    `tool-activation.js` -> `initialToolMessage`,
 *                              which is the string the status bar shows
 *
 * WHY THIS IS A SEPARATE, LAZY MODULE
 * -----------------------------------
 * `tool-activation.js` imports the toolbar, the toolbar imports the disciplines,
 * and several of those import the editor state. Reading all of that at start-up
 * to build a guide nobody has opened would put the guide in the boot path and
 * on the import graph of the editor. So the registries are imported the moment
 * the guide first needs them - by which time the application is fully loaded -
 * and everything below reads them at call time.
 *
 * WHAT IS *NOT* DERIVED, AND WHY
 * ------------------------------
 * The registry says WHAT a tool is and where the student finds it. It does not
 * say what happens after the first click, because that is behaviour spread
 * across the interaction layer. So a tool's multi-step "how it is used" text,
 * its property notes and its usage tips live in an authored table in
 * `guide-content.js`, keyed by the SAME tool id. That table never repeats a
 * name, a group or a shortcut - it only adds the part the registry cannot know.
 */

let registry = null;

/*
 * The registries, loaded once. Imported dynamically so this module is inert
 * until the guide is actually opened.
 */
async function loadRegistry() {
  if (registry) {
    return registry;
  }

  const loaded = await Promise.all([
    import("../../components/layout/toolbar/tools.js"),
    import("../../features/workspace/statics/statics-tools.js"),
    import("../../features/workspace/dynamics/dynamics-hierarchy.js"),
    import("../../features/workspace/dynamics/dynamics-tools.js"),
    import("../../features/workspace/model/fluids/fluids-tools.js"),
    import("../../features/workspace/model/heat-transfer/heat-tools.js"),
    import("../../features/workspace/math/math-tool-groups.js"),
    import("../../features/workspace/math/math-tools.js"),
    import("../../components/layout/toolbar/tool-activation.js"),
  ]);

  const [
    toolbar,
    staticsTools,
    dynamicsHierarchy,
    dynamicsTools,
    fluids,
    heat,
    math,
    mathTools,
    activation,
  ] = loaded;

  registry = {
    toolbar,
    staticsTools,
    dynamics: {
      DYNAMICS_TOOL_MENUS: dynamicsTools.DYNAMICS_TOOL_MENUS || {},
      groups: dynamicsHierarchy.DYNAMICS_TOOL_GROUPS || [],
    },
    fluids,
    heat,
    math,
    mathTools,
    activation,
  };

  return registry;
}

/* One label per tool id, from whichever table the toolbar builds it in. */
function labelOf(reg, toolId) {
  const direct = reg.toolbar.drawToolLabelById?.[toolId];

  if (direct) {
    return direct;
  }

  if (toolId === "support" || toolId === "supports") {
    return "Supports";
  }

  if (toolId === "connection" || toolId === "connections") {
    return "Connections";
  }

  return toolId;
}

/*
 * Every tool a section offers, walking the SAME group tables the toolbar
 * renders - groups, submenu parents and their children included. A tool added
 * to a section appears in the guide with no edit here.
 */
function entriesOfGroups(reg, groups) {
  const entries = [];

  (groups || []).forEach((group) => {
    (group.tools || []).forEach((tool) => {
      const children =
        (reg.staticsTools.STATICS_TOOL_MENUS || {})[tool.id] ||
        (reg.fluids.FLUIDS_TOOL_MENUS || {})[tool.id] ||
        (reg.heat.HEAT_TOOL_MENUS || {})[tool.id] ||
        (reg.dynamics.DYNAMICS_TOOL_MENUS || {})[tool.id] ||
        null;

      if (children && children.length) {
        entries.push({
          id: tool.id,
          label: tool.label,
          group: group.label,
          parent: true,
          children: children.map((child) => ({
            id: child.id,
            label: child.label,
            group: tool.label,
          })),
        });

        return;
      }

      entries.push({
        id: tool.id,
        label: labelOf(reg, tool.id) || tool.label,
        group: group.label,
        parent: false,
        shortcut: tool.shortcut || null,
      });
    });
  });

  return entries;
}

/*
 * The four registries that are a LIST OF GROUPS, plus the two flat categories
 * (Mechanical Design and Controls) whose entries live in `engineeringTools`.
 */
function groupsFor(reg, category) {
  switch (category) {
    case "GEOMETRY":
      return reg.toolbar.drawingToolGroups;
    case "ANNOTATE":
      return reg.toolbar.disciplineToolGroups.ANNOTATE;
    case "STATICS":
      return reg.toolbar.disciplineToolGroups.STATICS;
    case "DYNAMICS":
      return reg.toolbar.disciplineToolGroups.DYNAMICS;
    case "FLUIDS":
      return reg.toolbar.disciplineToolGroups.FLUIDS;
    case "THERMODYNAMICS":
      return reg.toolbar.disciplineToolGroups.THERMODYNAMICS;
    case "HEAT TRANSFER":
      return reg.toolbar.disciplineToolGroups["HEAT TRANSFER"];
    case "SOLID MECHANICS":
      return reg.toolbar.disciplineToolGroups["SOLID MECHANICS"];
    case "MATH / ANALYSIS":
      return reg.math.MATH_TOOL_GROUPS;
    default:
      return null;
  }
}

/* A flat category's entries, from the table the toolbar renders. */
function flatEntries(reg, category) {
  const declared = (reg.toolbar.flatToolDefinitions || {})[category] || null;

  if (declared) {
    return declared.map((tool) => ({
      id: tool.id,
      label: labelOf(reg, tool.id) || tool.label,
      group: null,
      parent: false,
      shortcut: tool.shortcut || null,
    }));
  }

  return (reg.toolbar.engineeringTools?.[category] || []).map((label) => ({
    id: null,
    label,
    group: null,
    parent: false,
  }));
}

/*
 * THE TOOLS OF ONE CATEGORY, as the guide lists them.
 *
 * Each entry carries the id and the name the toolbar uses. A caller then adds
 * the parts of the description that are authored rather than registered - see
 * `guide-content.js`, which is keyed by the same tool ids.
 */
export async function toolsForCategory(category) {
  const reg = await loadRegistry();

  const groups = groupsFor(reg, category);

  if (groups) {
    return entriesOfGroups(reg, groups);
  }

  return flatEntries(reg, category);
}

/* A tool's registered name, and the key that arms it, if one is bound. */
export async function definitionOf(toolId) {
  const reg = await loadRegistry();

  return {
    label: labelOf(reg, toolId),
    shortcut: shortcutOf(reg, toolId),
  };
}

function shortcutOf(reg, toolId) {
  const definition = (reg.toolbar.drawToolDefinitions || []).find(
    (tool) => tool.id === toolId,
  );

  return definition?.shortcut || null;
}

/*
 * THE INSTRUCTION THE APPLICATION ITSELF SHOWS when a tool is armed.
 *
 * Asking `initialToolMessage` is what keeps the guide honest: if a tool's
 * status line ever changes, the guide follows without an edit, and a tool whose
 * wording had to be invented would be immediately visible as one that returns
 * the generic "Ready".
 */
export async function openingInstructionOf(toolId) {
  if (!toolId) {
    return null;
  }

  const reg = await loadRegistry();

  try {
    /*
     * THE ARMED TOOL, NOT THE BUTTON. A Heat Transfer or Fluids entry may reuse
     * an ordinary geometry tool (`heatArmedTool`), and the instruction the
     * status line shows is the one for what was actually armed. The section
     * registries already answer that, so it is asked rather than guessed.
     */
    const armed =
      reg.heat?.heatArmedTool?.(toolId) || toolId;

    const message = reg.activation.initialToolMessage(armed);

    return message && message !== "Ready" ? message : null;
  } catch (error) {
    /* A tool the activation layer does not know: no instruction, no guess. */
    return null;
  }
}

/*
 * THE MATH SECTION'S OPENING INSTRUCTION, including the mode it is armed in.
 *
 * Kept separate because the wording genuinely depends on the mode - a Graph
 * armed as Sketch asks for a drag, and the same tool armed as Plot asks for an
 * expression. The guide never authors this line; it asks the Math module.
 */
export async function mathInstructionOf(toolId, mode) {
  const reg = await loadRegistry();

  try {
    return reg.mathTools.mathInstruction?.(toolId, mode) || null;
  } catch (error) {
    return null;
  }
}

/*
 * WHETHER A TOOL IS REGISTERED BUT ITS BEHAVIOUR IS NOT BUILT YET.
 *
 * The registries already say so (`planned`), and the activation layer already
 * refuses to arm such a tool. The guide asks the same question rather than
 * inferring it from prose.
 */
export async function isPlannedTool(toolId) {
  if (!toolId) {
    return false;
  }

  const reg = await loadRegistry();

  return Boolean(
    reg.fluids.isPlannedFluidsTool?.(toolId) ||
      reg.heat.isPlannedHeatTool?.(toolId),
  );
}

/*
 * HOW A TOOL TAKES ITS INPUT, asked of the module that decides it.
 *
 * `tool-classification.js` already classifies every creation tool as point-style,
 * click-click, multi-step or one-gesture, because the click router depends on
 * the answer. The guide asks the SAME question rather than describing a gesture
 * from memory - so a tool whose interaction changes cannot be documented as the
 * thing it used to be.
 *
 * Returns a short phrase, or null when the classification does not know the
 * tool (a Modify tool, a view command) - and the caller then omits the line
 * rather than guessing.
 */
export async function gestureOf(toolId) {
  if (!toolId) {
    return null;
  }

  const classification = await import(
    "../../components/layout/toolbar/tool-classification.js"
  );

  try {
    if (classification.isPointTool(toolId)) {
      return "A single click places it.";
    }

    if (classification.isMultiStepTool(toolId)) {
      return "Built from a sequence of clicks; Enter or a double-click finishes it.";
    }

    if (classification.isClickClickTool(toolId)) {
      return "Click twice (or press and drag) to set its two ends.";
    }
  } catch (error) {
    return null;
  }

  return null;
}

/*
 * THE NAME OF A STATICS FEATURE TYPE, from the table that already names every
 * one of them - so a guide that names a Beam calls it what the Feature Tree
 * calls it, rather than humanising the type id a second way.
 *
 * Returns null for anything that is not a Statics feature, and the caller then
 * uses the tool's own registered name rather than inventing one.
 */
export async function staticsFeatureName(type) {
  if (!type) {
    return null;
  }

  const reg = await loadRegistry();

  const name = reg.staticsTools.STATICS_FEATURE_LABELS?.[type];

  return typeof name === "string" ? name : null;
}

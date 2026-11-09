/*
 * ============================================================
 * THE MATH / ANALYSIS SIDEBAR
 * ============================================================
 *
 * The section's organisation, as data: four headings, each with its tools
 * listed directly underneath.
 *
 *     Select      the shared selection system, offered first
 *     Create      Point, Vector, Function Curve, Coordinate Graph, Equation
 *     Analysis    Tangent / Normal, Slope Triangle
 *     Reference   Coordinate System, Reference Point, Reference Line
 *
 * Create, Analysis and Reference are ordinary headings - not expandable
 * groups - so there is no second level, no caret and no flyout. A tool is a
 * command, and a command behind another command is a command the student has
 * to go looking for.
 *
 * THE REFERENCE TOOLS ARE THE STATICS ONES. They are listed here because a
 * Math drawing needs them, and they arm the SAME tool ids Statics arms - so
 * there is one Coordinate System, one Reference Point and one Reference Line
 * in the application, not a Math copy of each.
 *
 * WHY THIS IS A LEAF MODULE.
 *
 * The toolbar's own table (`components/layout/toolbar/tools.js`) folds these
 * definitions in, so a Math label resolves to its id for the command index and
 * the search. Importing them from `math-tools.js` closed a cycle - that module
 * arms tools, which reaches the toolbar, which reads this table - and the cycle
 * threw a temporal-dead-zone error at load. This file imports NOTHING, so both
 * sides can read it and neither depends on the other.
 */

/*
 * ONE GRAPH TOOL, NOT A GRAPH AND A CURVE.
 *
 * A coordinate graph and the functions drawn on it are parts of ONE
 * mathematical object, so they are created by ONE tool. The old `math-graph`
 * and `math-curve` tool ids are gone from the toolbar: a student picks Graph
 * and then chooses how to make it - by drawing it, or by typing its
 * expressions.
 *
 * THE TOOL IS CALLED GRAPH AND ITS MODES ARE SKETCH AND EXPRESSION.
 *
 * "Plot" is not used for either, because it names neither thing: the object is
 * a graph, and the second mode is where the student writes EXPRESSIONS that
 * DAETUM draws. The internal type stays `math-plot` so a saved drawing keeps
 * loading - the visible name and the stored type are deliberately separate.
 */
export const MATH_TOOL_IDS = Object.freeze({
  point: "math-point",
  vector: "math-vector",
  plot: "math-plot",
  equation: "math-equation",
  tangent: "math-tangent",
  slopeTriangle: "math-slope-triangle",
});

export const MATH_CREATE_TOOLS = Object.freeze([
  MATH_TOOL_IDS.point,
  MATH_TOOL_IDS.vector,
  MATH_TOOL_IDS.plot,
  MATH_TOOL_IDS.equation,
]);

export const MATH_ANALYSIS_TOOLS = Object.freeze([
  MATH_TOOL_IDS.tangent,
  MATH_TOOL_IDS.slopeTriangle,
]);

/*
 * THE REFERENCE TOOLS ARE THE STATICS ONES, BY THEIR OWN IDS.
 *
 * `coordinate-system` is the menu entry Statics uses; it arms
 * `coordinate-system-2d`. The other two are ordinary tool ids.
 */
export const MATH_REFERENCE_TOOLS = Object.freeze([
  "coordinate-system",
  "reference-point",
  "reference-line",
]);

export const MATH_TOOLS = Object.freeze([
  ...MATH_CREATE_TOOLS,
  ...MATH_ANALYSIS_TOOLS,
]);

export function isMathTool(toolId) {
  return MATH_TOOLS.includes(toolId);
}

export const MATH_TOOL_GROUPS = Object.freeze([
  {
    id: "math-selection",
    label: "Select",
    tools: [{ id: "select", label: "Select", shortcut: "Esc" }],
  },
  {
    id: "math-create",
    label: "Create",
    tools: [
      { id: MATH_TOOL_IDS.point, label: "Point", iconLabel: "Math Point" },
      { id: MATH_TOOL_IDS.vector, label: "Vector", iconLabel: "Math Vector" },
      { id: MATH_TOOL_IDS.plot, label: "Graph", iconLabel: "Coordinate Graph" },
      {
        id: MATH_TOOL_IDS.equation,
        label: "Equation / Expression",
        iconLabel: "Equation",
      },
    ],
  },
  {
    id: "math-analysis",
    label: "Analysis",
    tools: [
      {
        id: MATH_TOOL_IDS.tangent,
        label: "Tangent / Normal",
        iconLabel: "Tangent Normal",
      },
      {
        id: MATH_TOOL_IDS.slopeTriangle,
        label: "Slope Triangle",
        iconLabel: "Slope Triangle",
      },
    ],
  },
  {
    id: "math-reference",
    label: "Reference",
    tools: [
      {
        id: "coordinate-system",
        label: "Coordinate System",
        iconLabel: "Coordinate System",
      },
      {
        id: "reference-point",
        label: "Reference Point",
        iconLabel: "Reference Point",
      },
      {
        id: "reference-line",
        label: "Reference Line",
        iconLabel: "Reference Line",
      },
    ],
  },
]);

/* ============================================================
 * SKETCH / PLOT
 * ============================================================
 *
 * The same two modes, and the same labels, the Statics diagrams use - so a
 * student who has learned the pair in one section recognises it in the other.
 */

export const MATH_MODES = Object.freeze(["sketch", "plot"]);

/*
 * THE TWO MODES, AS THE STUDENT SEES THEM.
 *
 * The TOOL is called Graph; its two creation options are Sketch and Plot. The
 * stored mode ids are the same words, so a saved graph records exactly what the
 * student chose.
 */
export const MATH_MODE_LABELS = Object.freeze({
  sketch: "Sketch",
  plot: "Plot",
});

/*
 * THE TOOLS THAT OFFER BOTH MODES.
 *
 * ONLY THE GRAPH. A graph is genuinely two things - one the student drew, or
 * one they built from expressions - and the two are different ways of making
 * the SAME object.
 *
 * TANGENT / NORMAL AND SLOPE TRIANGLE ARE NOT MODE TOOLS. Each is ONE
 * construction with one workflow: pick the parent, pick the contact or the two
 * positions, and DAETUM derives the geometry from it. Offering Sketch and Plot
 * there asked the student to choose how the object would be made before they
 * had said what it was made from, and the two answers produced objects that
 * behaved identically - so the choice was a step that changed nothing.
 */
export const MATH_MODE_TOOLS = Object.freeze([MATH_TOOL_IDS.plot]);

export function mathToolHasModes(toolId) {
  return MATH_MODE_TOOLS.includes(toolId);
}

export default {
  MATH_TOOL_IDS,
  MATH_CREATE_TOOLS,
  MATH_ANALYSIS_TOOLS,
  MATH_REFERENCE_TOOLS,
  MATH_TOOLS,
  MATH_TOOL_GROUPS,
  MATH_MODES,
  MATH_MODE_LABELS,
  MATH_MODE_TOOLS,
  isMathTool,
  mathToolHasModes,
};

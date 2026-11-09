/*
 * ============================================================
 * THE MATH / ANALYSIS TOOLS
 * ============================================================
 *
 * The tool ids, the sidebar's organisation, and the one place a Math tool is
 * armed. Everything else - the geometry, the rendering, the Features panel and
 * the source - reads the ids from here, so a tool cannot be called one thing in
 * the toolbar and another in the model.
 *
 * THE SIDEBAR IS FOUR HEADINGS, NOT A TREE.
 *
 *     Select      the shared selection system, offered first
 *     Create      Point, Vector, Function Curve, Coordinate Graph, Equation
 *     Analysis    Tangent / Normal, Slope Triangle
 *     Reference   Coordinate System, Reference Point, Reference Line
 *
 * Create, Analysis and Reference are ordinary headings with their tools listed
 * directly underneath - the same shape Statics and Annotate use. There is no
 * second level, no caret and no flyout: a tool is a command, and a command
 * behind another command is a command the student has to go looking for.
 *
 * THE REFERENCE TOOLS ARE THE STATICS ONES. They are listed here because a
 * Math drawing needs them, and they arm the SAME tool ids Statics arms - so
 * there is one Coordinate System, one Reference Point and one Reference Line in
 * the application, not a Math copy of each.
 *
 * SKETCH AND PLOT ARE MODES OF A TOOL, NOT TOOLS.
 *
 * Function Curve, Tangent / Normal and Slope Triangle each offer both, because
 * both make sense for them: a curve can be traced or plotted, a tangent can be
 * drawn or derived, a slope triangle can be sketched or constrained to a line.
 * Point, Vector, Coordinate Graph and Equation offer neither, because there is
 * nothing to sketch or plot - they are placed.
 */

import enggDrawingState from "../../../shared/model/drawing-state.js";
import { drawingState } from "../editor-state.js";
import { activateTool } from "../../../components/layout/toolbar/tool-activation.js";
import { setToolMessage } from "../../../components/layout/toolbar/toolbar-render.js";
import { renderCurrentDrawing } from "../../../components/layout/workspace/canvas-render.js";
import { renderProperties } from "../../../components/layout/panels/feature-panel.js";
import { renderEngineeringTools } from "../../../components/layout/toolbar/toolbar-render.js";
import { activeCategory } from "../../../components/layout/toolbar/tool-menus.js";
import enggMathPlotEditor from "./math-plot-editor.js";
import enggMathSketchEditor from "./math-sketch-editor.js";
import enggMathCreation from "./math-creation.js";
import enggPlacementSession from "../interaction/placement-session.js";
import enggGridPlacement from "../../../shared/placement/grid-placement.js";
import {
  MATH_ANALYSIS_TOOLS,
  MATH_CREATE_TOOLS,
  MATH_MODE_LABELS,
  MATH_MODE_TOOLS,
  MATH_MODES,
  MATH_REFERENCE_TOOLS,
  MATH_TOOL_GROUPS,
  MATH_TOOL_IDS,
  MATH_TOOLS,
  isMathTool,
  mathToolHasModes,
} from "./math-tool-groups.js";

/*
 * THE IDS, THE SIDEBAR AND THE MODE TABLE LIVE IN `math-tool-groups.js`.
 *
 * That module imports nothing, so the toolbar's own table can fold the Math
 * definitions in without closing a cycle back through this one - which arms
 * tools, and arming reaches the toolbar. They are re-exported here so every
 * caller keeps asking this module, and there is still one place a Math tool is
 * named.
 */
export {
  MATH_ANALYSIS_TOOLS,
  MATH_CREATE_TOOLS,
  MATH_MODE_LABELS,
  MATH_MODE_TOOLS,
  MATH_MODES,
  MATH_REFERENCE_TOOLS,
  MATH_TOOL_GROUPS,
  MATH_TOOL_IDS,
  MATH_TOOLS,
  isMathTool,
  mathToolHasModes,
};

/* The mode a Math tool is currently armed in, or null. */
export function activeMathMode() {
  const toolId = drawingState.activeTool;

  if (!mathToolHasModes(toolId)) {
    return null;
  }

  const mode = drawingState.interaction?.mathMode;

  return MATH_MODES.includes(mode) ? mode : null;
}

/* ============================================================
 * ARMING
 * ============================================================
 *
 * ONE function, and the order is the one that works:
 *
 *     arm the tool  ->  record the mode  ->  begin the placement
 *
 * `activateTool` CLEARS the interaction, so a mode written before it would be
 * thrown away; and the placement reads the mode, so a mode written after it
 * would arrive too late. Both faults have existed in this application before,
 * one in each caller, because each caller wrote the sequence itself.
 *
 * SWITCHING MODE IS SAFE BY CONSTRUCTION. The placement is reset to its first
 * stage and nothing is committed, so an incomplete operation is abandoned
 * rather than carried into the new mode - and a completed object is a feature
 * in the document and is not touched at all.
 */
export function armMathTool(toolId, mode = null) {
  if (!isMathTool(toolId)) {
    return false;
  }

  if (mode !== null && !MATH_MODES.includes(mode)) {
    return false;
  }

  activateTool(toolId);

  if (mode) {
    enggDrawingState.setInteraction(drawingState, { mathMode: mode });
  }

  beginMathTool(toolId);

  /*
   * THE GRAPH TOOL OPENS ITS EDITOR.
   *
   * Sketch and Plot are two dedicated working spaces, not two canvas
   * interactions: choosing one opens the editor for it, and the editor's Apply
   * is what commits the graph. The tool is armed first so the editor knows
   * which mode it is in and the toolbar shows the right button lit.
   */
  if (toolId === MATH_TOOL_IDS.plot && mode) {
    openGraphEditor(mode);
  }

  renderEngineeringTools(activeCategory());
  renderProperties();
  renderCurrentDrawing();

  return true;
}

/*
 * OPEN THE EDITOR FOR A GRAPH MODE.
 *
 * `graph` is the object being edited, or null for a new one. The editor is
 * chosen by the MODE, so a Sketch-created graph reopens in the Sketch Editor
 * and a Plot-created one in the Plot Editor - which is what makes "edit this
 * graph" mean the same thing as "make one this way".
 */
export function openGraphEditor(mode, graph = null) {
  if (mode === "sketch") {
    return enggMathSketchEditor.openSketchEditor(graph, {
      /*
       * THE EDITOR'S OWN -5..5 FRAME IS THE SKETCH'S COORDINATE SYSTEM, so the
       * geometry it hands back is already in graph coordinates and a new sketch
       * is committed into a box with those limits. A graph being edited keeps
       * its own limits, which is why they are read from it rather than assumed.
       */
      targetGeometry: graph?.geometry || null,
      onApply: (result) => beginGraphPlacement(result, graph, "sketch"),
      onCancel: () => finishGraphEditing(),
    });
  }

  return enggMathPlotEditor.openPlotEditor(graph, {
    onApply: (result) => beginGraphPlacement(result, graph, "plot"),
    onCancel: () => finishGraphEditing(),
  });
}

/*
 * THE GRAPH A PLACEMENT WILL COMMIT, as an object the renderer can draw.
 *
 * It is built from the same result the commit uses, scaled by the same
 * placement transform, so the box, the axes, the tick spacing and every curve
 * under the cursor are the ones that land. It carries no id and is never added
 * to the document: it is a preview object, drawn by the ordinary renderer.
 */
function previewObject(result, mode, placement) {
  const geometry = result?.geometry || {};

  const scale = placement?.scale || 1;

  const position = placement
    ? enggGridPlacement.applyPlacement(geometry.position, placement)
    : geometry.position;

  if (mode !== "sketch") {
    /*
     * A Plot's curves are sampled from its expressions through its own box, so
     * the preview only needs the box scaled about the anchor.
     */
    return {
      type: "math-plot",
      style: { ...(result?.style || {}) },
      geometry: {
        ...geometry,
        position,
        width: (Number(geometry.width) || 200) * scale,
        height: (Number(geometry.height) || 200) * scale,
        mode: "plot",
      },
    };
  }

  const strokes = (result?.strokes || []).map((stroke) => ({
    ...stroke,
    points: enggGridPlacement.applyPlacementToPoints(stroke.points || [], placement),
    original: enggGridPlacement.applyPlacementToPoints(
      stroke.original || stroke.points || [],
      placement,
    ),
  }));

  return {
    type: "math-plot",
    style: { ...(result?.style || {}) },
    geometry: {
      ...geometry,
      position,
      width: (Number(geometry.width) || 200) * scale,
      height: (Number(geometry.height) || 200) * scale,
      mode: "sketch",
      showTickLabels: false,
      /*
       * THE STROKES HERE ARE ALREADY IN DRAWING UNITS - `applyPlacementToPoints`
       * has just mapped each one - while the object's own paths are stored in
       * graph coordinates. This flag tells the readers of these paths that this
       * preview carries drawing-space points, so nothing maps them twice.
       */
      __drawingSpace: true,
      functions: strokes.map((stroke) => ({
        id: stroke.id || "preview-function",
        mode: "sketch",
        expression: "",
        variable: "x",
        domain: { min: -5, max: 5 },
        visible: true,
        style: null,
        points: stroke.points,
        segments: stroke.segments || [],
        originalTrace: stroke.original,
        showOriginalTrace: stroke.showOriginalTrace === true,
        smoothing: 0,
        correction: stroke.correction || null,
        fitType: "none",
        fitExpression: "",
        showFitExpression: false,
      })),
    },
  };
}

/*
 * ============================================================
 * APPLY HANDS THE GRAPH TO THE PLACEMENT, IT DOES NOT COMMIT IT
 * ============================================================
 *
 * The editor's Apply used to commit at whatever coordinates the graph was
 * drawn at, which is almost never where the student wanted it. The graph is
 * finished, but its POSITION is still theirs to choose - so Apply returns to
 * the page with the graph following the cursor, and the click is what commits
 * it.
 *
 * THE GRAPH'S OWN CALIBRATION TRAVELS WITH IT. A graph knows its origin and
 * its tick spacing, which is exactly what the placement needs to align it to
 * the page grid - so it is read here, once, and handed over.
 *
 * EDITING AN EXISTING GRAPH IS NOT A PLACEMENT. The object is already on the
 * sheet at a position the student chose; reopening it to change an expression
 * must not move it. So an edit commits in place, and only a NEW graph is
 * placed.
 */
function beginGraphPlacement(result, existing, mode) {
  if (existing) {
    if (mode === "sketch") {
      commitGraphFromSketch(result, existing);
    } else {
      commitGraphFromPlot(result, existing);
    }

    return;
  }

  const strokes =
    mode === "sketch"
      ? (result?.strokes || []).map((stroke) => ({
          points: stroke.points || [],
        }))
      : [];

  /*
   * A PLOT HAS NO STROKES TO PLACE - its curves are sampled from expressions -
   * so its placement is anchored on its own box, and the box is what moves.
   */
  const geometry = result?.geometry || {};

  const placementStrokes = strokes.length
    ? strokes
    : [
        {
          points: [
            { x: 0, y: 0 },
            { x: Number(geometry.width) || 200, y: 0 },
            { x: Number(geometry.width) || 200, y: Number(geometry.height) || 200 },
            { x: 0, y: Number(geometry.height) || 200 },
          ],
        },
      ];

  enggPlacementSession.beginPlacement(
    {
      strokes: placementStrokes,
      calibration: enggGridPlacement.graphCalibration({
        geometry: { ...geometry, mode },
      }),
      /*
       * THE OBJECT THIS PLACEMENT WILL BECOME, shown by the canvas exactly as
       * it will be committed. A sketch's preview used to draw the ink alone,
       * so the student placed a few lines and got a boxed graph with axes -
       * which is not the thing they were aiming. The commit applies the SAME
       * transform to the SAME object, so the preview is the placement.
       */
      preview: (placement) => previewObject(result, mode, placement),
    },
    {
      commit: (placement) => {
        if (mode === "sketch") {
          commitGraphFromSketch(result, null, placement);
        } else {
          commitGraphFromPlot(result, null, placement);
        }
      },
      cancel: () => finishGraphEditing(),
    },
  );
}

/*
 * THE EDITOR CLOSED WITHOUT APPLYING.
 *
 * Nothing was committed, so the sheet is already correct - the tool simply
 * returns to Select, which is what "I am finished here" means.
 */
function finishGraphEditing() {
  activateTool("select");

  renderEngineeringTools(activeCategory());
  renderProperties();
  renderCurrentDrawing();
}

/* Commit a graph built in the Plot Editor. */
function commitGraphFromPlot(result, existing, placement = null) {
  enggMathCreation.commitGraphFromPlot(result, existing, placement);

  finishGraphEditing();
}

/* Commit a graph drawn in the Sketch Editor. */
function commitGraphFromSketch(result, existing, placement = null) {
  enggMathCreation.commitGraphFromSketch(result, existing, placement);

  finishGraphEditing();
}

/* ============================================================
 * THE OPENING INSTRUCTION
 * ============================================================ */

export function mathInstruction(toolId, mode = null) {
  const chosen = mode || drawingState.interaction?.mathMode || "sketch";

  switch (toolId) {
    case MATH_TOOL_IDS.point:
      return "Click to place a point";

    case MATH_TOOL_IDS.vector:
      return "Press at the tail and drag to the head";

    case MATH_TOOL_IDS.equation:
      return "Click where the equation should sit, then type it";

    case MATH_TOOL_IDS.plot:
      return chosen === "plot"
        ? "Drag out the graph's area, then add its expressions"
        : "Draw the graph - axes, lines and curves - then Apply";

    case MATH_TOOL_IDS.tangent:
      return "Click the curve to place the construction on";

    case MATH_TOOL_IDS.slopeTriangle:
      return "Click a straight line, then click the two positions along it";

    default:
      return "Ready";
  }
}

/* ============================================================
 * BEGINNING A PLACEMENT
 * ============================================================
 *
 * Every Math tool is armed in an IDLE interaction with its own mode recorded.
 * The click and drag routers then decide what a press means from the tool id
 * and the phase - there is no second state machine here.
 */
export function beginMathTool(toolId) {
  const mode = drawingState.interaction?.mathMode || "sketch";

  enggDrawingState.setInteraction(drawingState, {
    phase: "idle",
    mathTool: toolId,
    mathMode: mathToolHasModes(toolId) ? mode : null,
    mathStage: null,
    mathTargetId: null,
    mathContact: null,
    mathStart: null,
    mathEnd: null,
    mathPreview: null,
  });

  setToolMessage(mathInstruction(toolId, mode));
}

/* ============================================================
 * THE MODE MENU
 * ============================================================
 *
 * The toolbar's inline list, exactly as the Statics diagrams offer theirs: the
 * two modes under the tool, with the armed one lit.
 */
export function mathModeOptions(toolId) {
  if (!mathToolHasModes(toolId)) {
    return [];
  }

  const active = drawingState.activeTool === toolId ? activeMathMode() : null;

  return MATH_MODES.map((mode) => ({
    mode,
    label: MATH_MODE_LABELS[mode],
    active: active === mode,
  }));
}

const enggMathTools = {
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
  activeMathMode,
  armMathTool,
  beginMathTool,
  openGraphEditor,
  mathInstruction,
  mathModeOptions,
};

export default enggMathTools;

/*
 * Activating a tool, undo/redo, and turning pointer events into drawing coordinates.
 */

import enggDrawingState from "../../../shared/model/drawing-state.js";
import { isAnnotationTool } from "../../../features/workspace/annotate/annotation-tool.js";
import { annotateInstruction, isAnnotateTool } from "../../../features/workspace/annotate/annotate-creation.js";
import { analysisInputMessage, isAnalysisInputTool } from "../../../features/workspace/statics/analysis-tools.js";
import { renderCurrentDrawing } from "../workspace/canvas-render.js";
import { isDimensionTool } from "../../../features/workspace/annotate/dimension-tool.js";
import { drawingCanvas, drawingRedo, drawingUndo } from "../../../features/workspace/dom.js";
import { drawingState } from "../../../features/workspace/editor-state.js";
import { renderProperties } from "../panels/feature-panel.js";
import { cancelModifySession } from "../../../features/workspace/commands/modify-tools.js";
import { STATICS_CHILD_TOOLS, STATICS_PLACEMENT_TOOLS, STATICS_SPAN_TOOLS, isBodyAttachedTool, staticsBodyMessage, staticsInstruction } from "../../../features/workspace/statics/statics-tools.js";
import { DYNAMICS_ANGLE_TOOLS, DYNAMICS_BOX_TOOLS, DYNAMICS_PLACEMENT_TOOLS, DYNAMICS_SPAN_TOOLS, dynamicsInstruction, isDynamicsTool } from "../../../features/workspace/dynamics/dynamics-tools.js";
import enggFluidsTools from "../../../features/workspace/model/fluids/fluids-tools.js";
import { fluidsArmedTool, fluidsInstruction, isFluidsTool } from "../../../features/workspace/interaction/fluids-tool.js";
import { beginRouteConstruction } from "../../../features/workspace/interaction/pipe-duct-tool.js";
import { activeCategory, closePolygonSidesPrompt } from "./tool-menus.js";
import { renderEngineeringTools, setToolMessage } from "./toolbar-render.js";
import { clearGlobalToolHighlight } from "../workspace/workspace-controls.js";
import { isLegacyResetTool, legacyPlaceholderMessage } from "./phase-reset.js";

export function activate2DCoordinateSystemTool() {
    /*
     * PHASE 1 RESET: the coordinate system tool is a placeholder.
     * The original arming and placement implementation has been
     * removed with the legacy tools.
     */
    if (isLegacyResetTool("coordinate-system-2d")) {
        setToolMessage(legacyPlaceholderMessage());
        renderEngineeringTools(activeCategory());
        return;
    }

    enggDrawingState.setActiveTool(
        drawingState,
        "coordinate-system-2d"
    );

    drawingState.interaction.phase =
        "idle";

    setToolMessage(
        "Specify origin"
    );

    renderEngineeringTools(
        activeCategory()
    );

    renderCurrentDrawing();
}

export function activateTool(
    toolId
) {
    if (
        toolId ===
        "coordinate-system"
    ) {
        toolId = "coordinate-system-2d";
    }

    /*
     * ========================================================
     * A FLUIDS TOOL ARMS THE SHARED SYSTEM ITS ENTRY NAMES
     * ========================================================
     *
     * The Fluids section reuses existing systems rather than duplicating
     * them, so pressing a Fluids button arms the tool that ACTUALLY runs:
     *
     *     a shape entry      its primitive (`line`, `rectangle`, `point`),
     *                        so the shared creation pipeline draws it
     *     an annotate entry  its own id, routed to the Annotate handler
     *     a dimension entry  its own id, routed to the dimension handler
     *
     * `fluidsArmedTool` is the one place that decision is made, and the
     * toolbar asks the same module which button to highlight - so the button
     * the student pressed and the tool that runs cannot disagree.
     *
     * A PLANNED entry has no behaviour to arm, so it is refused here with an
     * honest message rather than leaving a tool active that does nothing.
     */
    if (enggFluidsTools.isPlannedFluidsTool(toolId)) {
        setToolMessage(fluidsInstruction(toolId));
        return;
    }

    const requestedTool = isFluidsTool(toolId)
        ? fluidsArmedTool(toolId)
        : toolId;

    /*
     * Choosing Select always abandons whatever the
     * previous tool was doing, so a half-finished
     * operation can never be left running underneath.
     */
    if (
        requestedTool === "select"
    ) {
        closePolygonSidesPrompt();

        clearGlobalToolHighlight();

        enggDrawingState.clearInteraction(
            drawingState
        );

        drawingState.selection
            .boxSelectionIds = [];

        enggDrawingState.setActiveTool(
            drawingState,
            "select"
        );

        setToolMessage(
            "Select geometry"
        );

        renderEngineeringTools(
            activeCategory()
        );

        renderCurrentDrawing();
        return;
    }

    /*
     * Re-clicking the active tool cancels it, so the user is
     * never stuck inside it. Tools that place a feature are
     * the exception: once one has been committed the
     * operation is finished, so re-clicking simply keeps them
     * armed for placing another one.
     *
     * A body-attached tool counts as a placement tool, because
     * it too ends by creating a feature rather than by
     * finishing a drawing. Without this, picking a second
     * attached tool while the first is still active would
     * toggle it off instead of switching to it.
     */
    /*
     * PHASE 1 RESET: every non-navigation tool is a placeholder.
     * The tool stays highlighted in its category and reports that
     * its drawing implementation has been removed; no construction
     * state is entered and nothing is drawn.
     */
    if (isLegacyResetTool(toolId)) {
        cancelModifySession();
        clearGlobalToolHighlight();
        closePolygonSidesPrompt();

        enggDrawingState.clearInteraction(drawingState);
        enggDrawingState.setActiveTool(drawingState, toolId);

        setToolMessage(legacyPlaceholderMessage());

        renderEngineeringTools(activeCategory());
        renderCurrentDrawing();
        return;
    }

    /*
     * Arc and Polygon carry a construction METHOD (three-point vs
     * centre, centre vs side) chosen from their toolbar submenu. That
     * submenu arms the tool through here every time a method is picked,
     * so they must count as placement tools: otherwise choosing the
     * second method while the tool was already active would toggle it
     * back off to Select and the student would have to click the tool
     * again to get the method they just asked for.
     */
    /*
     * A STATICS SPAN TOOL IS A PLACEMENT TOOL TOO.
     *
     * `STATICS_PLACEMENT_TOOLS` lists the tools FINISHED by one click; the
     * spans - Beam, Cable, Shaft, Point Force, the three Connections and a
     * Reference Line - are not in it, because they take two clicks. They are
     * still tools that PLACE a feature, and re-clicking one must keep it armed
     * rather than cancel it.
     *
     * This list used to name `truss` by hand and omit every other span. The
     * result was silent and total: the Statics submenu arms a child tool
     * THROUGH `activateTool`, so the first call set `beam` and the second -
     * the toolbar's own click for the same gesture - read `activeTool ===
     * "beam"` and toggled it straight back to Select. The status line still
     * showed "Specify beam start point", so the tool LOOKED armed, and the drag
     * that followed drew nothing at all. That is the reported "statics tools no
     * longer render": nothing was ever created to render.
     *
     * Asked of the span table rather than of a second hand-written list, so a
     * span tool added there is covered here without another edit.
     */
    const isPlacementTool =
        Boolean(STATICS_PLACEMENT_TOOLS[requestedTool]) ||
        Boolean(STATICS_SPAN_TOOLS[requestedTool]) ||
        isBodyAttachedTool(requestedTool) ||
        /*
         * A DYNAMICS TOOL IS A PLACEMENT TOOL TOO, by the same reasoning:
         * every Dynamics tool places a feature, whether the gesture ends on
         * one click or two, and re-clicking it must keep it armed.
         */
        Boolean(DYNAMICS_PLACEMENT_TOOLS[requestedTool]) ||
        Boolean(DYNAMICS_SPAN_TOOLS[requestedTool]) ||
        Boolean(DYNAMICS_ANGLE_TOOLS[requestedTool]) ||
        Boolean(DYNAMICS_BOX_TOOLS[requestedTool]) ||
        requestedTool === "truss" ||
        requestedTool === "pipe-duct" ||
        requestedTool === "nozzle-diffuser" ||
        requestedTool === "point" ||
        requestedTool === "arc" ||
        requestedTool === "reference-arc" ||
        requestedTool === "polygon";

    const nextTool =
        drawingState.activeTool ===
                requestedTool &&
            !isPlacementTool
            ? "select"
            : requestedTool;

    /*
     * Picking any tool from the geometry list ends any
     * running Modify or View tool.
     */
    cancelModifySession();
    clearGlobalToolHighlight();

    closePolygonSidesPrompt();

    /*
     * PICKING A TOOL ABANDONS WHATEVER THE LAST ONE WAS PART-WAY THROUGH.
     *
     * The `select` branch above already does this, and for the same reason:
     * a half-finished operation must never be left running underneath the
     * tool that replaced it. Without it here, an armed annotate anchor - a
     * leader holding its first end, waiting for a second click - survived the
     * switch, and the NEXT tool's first press completed it: clicking Arrow
     * after Leader made a second LEADER. Clearing the interaction with the
     * tool change is what makes "this tool is now running" true.
     */
    enggDrawingState.clearInteraction(
        drawingState
    );

    enggDrawingState.setActiveTool(
        drawingState,
        nextTool
    );

    /*
     * REMEMBER WHICH FLUIDS BUTTON WAS PRESSED.
     *
     * A Fluids shape tool arms its PRIMITIVE (`line`, `rectangle`, `point`),
     * and several Fluids tools may share one primitive - Pump, Valve and Flow
     * Meter all place a Point. The primitive says which shared tool is running;
     * this says which Fluids button asked for it, so the toolbar highlights the
     * one the student pressed rather than all of them.
     *
     * Written AFTER the interaction is cleared, or the clear would drop it.
     */
    if (isFluidsTool(toolId)) {
        enggDrawingState.setInteraction(drawingState, {
            fluidsTool: toolId
        });
    }

    /*
     * ========================================================
     * THE PIPE / DUCT ROUTE BEGINS ITS OWN CONSTRUCTION
     * ========================================================
     *
     * Pipe / Duct is a CLICK-HOLD-DRAG tool: press the primary button to set
     * the start, drag to develop the double-line run and release to commit it.
     * Arming it therefore does NOT begin construction - there is nothing to
     * begin until the student presses the button. It arms the interaction in
     * its idle phase and waits.
     *
     * A run is one feature type. The circular/rectangular decision is a
     * property of that feature, so nothing is chosen here.
     */
    if (requestedTool === "pipe-duct") {
        beginRouteConstruction();

        renderEngineeringTools(
            activeCategory()
        );

        renderCurrentDrawing();

        return;
    }

    /*
     * A freshly activated tool gets its own opening
     * instruction; otherwise the previous tool's
     * instruction would linger.
     *
     * A FLUIDS TOOL IS ASKED FOR ITS OWN WORDING, by the id the student
     * pressed - not by the id that ended up armed. A Pipe / Duct arms the
     * shared Line tool, but the bottom bar must say "Specify Pipe / Duct start
     * point" rather than the Line's own line, because that is the tool the
     * student chose. The wording lives in the Fluids layer beside the binding
     * it describes.
     */
    setToolMessage(
        isFluidsTool(toolId)
            ? fluidsInstruction(toolId)
            : initialToolMessage(
                  nextTool
              )
    );

    renderEngineeringTools(
        activeCategory()
    );

    renderCurrentDrawing();
}

/*
 * The instruction a tool should show the moment it is
 * activated, so stale messages never carry over.
 */
export function initialToolMessage(
    toolId
) {
    /*
     * The two dimension tools open by asking for the thing to be
     * measured, and differ only in what they do once it is chosen.
     * Saying so up front is what stops a student pressing D and
     * waiting for a number that was never going to appear.
     */
    /*
     * The annotation tool says BOTH of its uses up front, because the
     * student has to know that clicking a feature and clicking empty
     * space are different actions before they try one of them.
     */
    if (
        isAnnotationTool(toolId)
    ) {
        return "Click a feature to label it, or empty space for a note";
    }

    /*
     * A RESULTANT OR A FORCE COMPONENTS TOOL ASKS FOR ITS INPUT BY NAME.
     *
     * These are child analysis features, and the one thing the student has to
     * say is which force(s) they read. The wording comes from the tool's own
     * module so the bottom bar and the tool cannot describe different things.
     */
    if (isAnalysisInputTool(toolId)) {
        return analysisInputMessage(toolId);
    }

    /*
     * AN ANNOTATE TOOL NAMES ITS OWN FIRST STEP.
     *
     * A geometric kind - a leader, a callout, an arrow - begins by asking
     * for its starting point; a point-placed kind asks for its location.
     * The wording comes from ONE function in the creation layer, so the
     * bottom bar and the tool can never describe different things.
     */
    if (isAnnotateTool(toolId)) {
        return annotateInstruction(toolId);
    }

    if (
        isDimensionTool(toolId)
    ) {
        /*
         * The dimension tool opens by asking for a REFERENCE, not a
         * whole feature: a reference may be a point, a line, a circle or
         * an arc, and the tool works out the measurement from what it is
         * given. Saying "reference" rather than "feature" is what tells
         * the student they may click a midpoint as readily as a body.
         */
        return "Specify dimension reference - D changes what is measured";
    }

    /*
     * A Statics tool carries its own opening instruction, so
     * a direct tool like Point Force tells the student what to
     * click next without opening a popup first.
     */
    if (
        isBodyAttachedTool(toolId)
    ) {
        /*
         * A body-attached feature begins by asking for the body
         * it acts on, rather than letting the student place it
         * in free space and attach it afterwards.
         */
        return staticsBodyMessage(toolId, 0);
    }

    if (
        STATICS_CHILD_TOOLS[toolId]
    ) {
        return staticsInstruction(
            toolId
        );
    }

    /*
     * A DYNAMICS TOOL CARRIES ITS OWN OPENING INSTRUCTION.
     *
     * The wording is built from the tool's declared placement, so a tool the
     * library adds is described correctly here without this file ever
     * learning the id. Without this branch every Dynamics tool opened with
     * the leftover "Ready" - the student could not tell the tool had armed
     * or what it wanted first.
     */
    if (isDynamicsTool(toolId)) {
        return dynamicsInstruction(toolId);
    }

    return (
        {
            select: "Select geometry",
            point: "Specify point",
            line: "Specify line start point",
            polyline: "Specify first point",
            triangle: "Specify first point",
            circle: "Specify centre point",
            rectangle: "Specify first corner",
            arc: "Specify arc start point",
            polygon: "Specify polygon centre",
            "freeform-polygon": "Drag to add vertices; return to the first vertex to close",
            "coordinate-system-2d": "Specify origin",
            "control-volume": "Drag from one corner to the opposite corner to draw a control volume",
            "tank": "Drag between opposite corners to draw a closed tank",
            "turbine-compressor": "Drag opposite corners to draw a turbine/compressor casing; select it to move, resize or rotate",
            "nozzle-diffuser": "Drag opposite corners to draw a nozzle/diffuser; select it to move, resize or rotate",
            "process-plot": "Drag to draw process axes; use the corner dots to resize and edit the axis labels",
            "saturation-curve": "Drag to draw a T-v saturation diagram; use the corner dots to resize it",
            "process-path": "Click inside a process diagram to place the first process state",
            "constant-temp-pressure-lines": "Click points on a process diagram to draw a constant temperature/pressure line; Enter finishes",
            "piston-cylinder": "Drag to draw a piston cylinder; select it and drag the centre dot to adjust piston height",
            "piston-cylinder-stoppers": "Drag to draw a piston cylinder with stoppers; drag a stopper dot to adjust its height",
            pan: "Drag to pan the view"
        }[toolId] || "Ready"
    );
}

/*
 * KEEP THE UNDO / REDO CONTROLS HONEST - WHERE THEY EXIST.
 *
 * These used to be buttons on the global tool bar. That bar is gone and the
 * commands live in the Edit menu, where the disabled state is read fresh each
 * time the menu opens (`menu-commands.js` asks `canUndo()` / `canRedo()`).
 *
 * The guard is not decoration: this function is called on every render, and
 * without it a missing button would throw a TypeError inside the render path -
 * which is how removing the bar the first time broke the whole application.
 * Reaching the buttons defensively lets the same function serve a layout with
 * them and one without.
 */
export function updateHistoryControls() {
    if (drawingUndo) {
        drawingUndo.disabled = !enggDrawingState.canUndo(drawingState);
    }

    if (drawingRedo) {
        drawingRedo.disabled = !enggDrawingState.canRedo(drawingState);
    }
}

export function performUndo() {
    if (
        enggDrawingState.undo(
            drawingState
        )
    ) {
        renderProperties();
        renderCurrentDrawing();
        setToolMessage(
            "Ready"
        );
    }
}

export function performRedo() {
    if (
        enggDrawingState.redo(
            drawingState
        )
    ) {
        renderProperties();
        renderCurrentDrawing();
        setToolMessage(
            "Ready"
        );
    }
}

export function canvasPointFromEvent(
    event,
    shouldSnap = false
) {
    const bounds =
        drawingCanvas.getBoundingClientRect();

    const width =
        drawingCanvas.clientWidth;

    const height =
        drawingCanvas.clientHeight;

    return enggDrawingState.screenToEngineering(
        {
            x:
                event.clientX -
                bounds.left,

            y:
                event.clientY -
                bounds.top
        },
        {
            width,
            height
        },
        drawingState,
        shouldSnap
    );
}

/*
 * Activating a tool, undo/redo, and turning pointer events into drawing coordinates.
 */

import enggDrawingState from "../../core/model/drawing-state.js";
import { isAnnotationTool } from "../annotate/annotation-tool.js";
import { annotateInstruction, isAnnotateTool } from "../annotate/annotate-creation.js";
import { analysisInputMessage, isAnalysisInputTool } from "../statics/analysis-tools.js";
import { renderCurrentDrawing } from "../workspace/canvas-render.js";
import { isDimensionTool } from "../annotate/dimension-tool.js";
import { drawingCanvas, drawingRedo, drawingUndo, toolList } from "../dom.js";
import { drawingState } from "../editor-state.js";
import { renderProperties } from "../panels/feature-panel.js";
import { cancelModifySession } from "../commands/modify-tools.js";
import { STATICS_CHILD_TOOLS, STATICS_PLACEMENT_TOOLS, isBodyAttachedTool, openCoordinateSystemMenu, staticsBodyMessage, staticsInstruction } from "../statics/statics-tools.js";
import { activeCategory, closePolygonSidesPrompt } from "./tool-menus.js";
import { renderEngineeringTools, setToolMessage } from "./toolbar-render.js";
import { clearGlobalToolHighlight } from "../workspace/workspace-controls.js";

export function activate2DCoordinateSystemTool() {
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
        openCoordinateSystemMenu(
            toolList.querySelector(
                '[data-tool-id="coordinate-system"]'
            )
        );

        return;
    }

    /*
     * Choosing Select always abandons whatever the
     * previous tool was doing, so a half-finished
     * operation can never be left running underneath.
     */
    if (
        toolId === "select"
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
    const isPlacementTool =
        Boolean(
            STATICS_PLACEMENT_TOOLS[
                toolId
            ]
        ) ||
        isBodyAttachedTool(toolId) ||
        toolId === "truss" ||
        toolId === "point";

    const nextTool =
        drawingState.activeTool ===
                toolId &&
            !isPlacementTool
            ? "select"
            : toolId;

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
     * A freshly activated tool gets its own opening
     * instruction; otherwise the previous tool's
     * instruction would linger.
     */
    setToolMessage(
        initialToolMessage(
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
         * The dimension tools open by asking for a REFERENCE, not a
         * whole feature: a reference may be a point, a line, a circle or
         * an arc, and the tool works out the measurement from what it is
         * given. Saying "reference" rather than "feature" is what tells
         * the student they may click a midpoint as readily as a body.
         */
        return toolId === "smart-dimension"
            ? "Specify dimension reference"
            : "Specify dimension reference - D changes what is measured";
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

    return (
        {
            select: "Select geometry",
            point: "Specify point",
            line: "Specify line start point",
            polyline: "Specify first point",
            triangle: "Specify first point",
            circle: "Specify centre point",
            rectangle: "Specify first corner",
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

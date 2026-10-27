/*
 * The editor's state: the document model, and the UI state shared between editor modules.
 */

import enggDrawingState from "../../shared/model/drawing-state.js";
import enggDrawingSnap from "../../shared/snapping/object-snap.js";
import enggSheets from "../../components/layout/workspace/sheets.js";

export const drawingState = enggDrawingState.createDrawingState();

export const drawingSnap = enggDrawingSnap;

/*
 * UI state shared between editor modules.
 *
 * These were module-level variables of the single controller file. An
 * imported binding cannot be reassigned, so state that more than one
 * module changes lives on this one object instead.
 */
export const editorState = {
    /*
     * ========================================================
     * THE PANEL'S THREE TABS
     * ========================================================
     */

    /*
     * Which of the inspector's tabs is open. Held here rather than in the
     * panel-tabs module so the selection sync can read it without importing
     * that module and forming a cycle. "objects" | "features" | "source".
     */
    drawingPanelTab: "objects",

    /*
     * The active tool's settings, keyed by tool id. Tool DEFAULTS - what the
     * next object the tool creates will be like - are deliberately separate
     * from the object model: changing a default must never rewrite an object
     * already drawn. See panels/features-pane.js for the store's contract.
     */
    toolSettings: {},

    /*
     * ========================================================
     * SHEETS
     * ========================================================
     */
    
    /*
     * The document's sheets.
     *
     * The editor has exactly ONE live drawing state, and it is always the
     * ACTIVE sheet. Switching sheets does not move geometry about and does
     * not ask the renderer to filter: it puts whatever is in the editor
     * back onto the sheet it came from, and loads the next sheet into the
     * editor.
     *
     * That is a deliberate choice over the alternative - making every
     * feature, every snap candidate and every hit-test aware of sheets. The
     * alternative would mean threading a sheet filter through thousands of
     * lines that have no business knowing, and the filter would have to be
     * remembered correctly in each one. Loading one sheet at a time means
     * the guarantee is structural instead of remembered: an inactive sheet
     * has no features in the editor at all, so it cannot be selected,
     * snapped to, dragged, or moved by a tool that was still armed. It
     * also means the Features panel, box selection and object snapping
     * need no sheet awareness whatsoever.
     */
    sheetCollection: enggSheets.createCollection(),

    coordinateSystemMenu: null,

    coordinateSystemMenuAnchor: null,

    polygonSidesPrompt: null,

    /*
     * ========================================================
     * TEXT ENTRY
     * ========================================================
     *
     * The id of the feature whose text is being typed right now, or null.
     *
     * The node-entry prompt is anchored to its feature and the feature must
     * stay visible while it is open, so the overlay draws this one object even
     * when the compiled picture already shows it (renderer.js). It is set and
     * cleared by the same open/close that owns the prompt, so it can never be
     * left behind: it holds no geometry, no text and no history, and nothing is
     * written to the object until the entry is committed.
     */
    textEntryObjectId: null,

    selectionClickSuppressed: false,

    selectedPlantNode: null,

    selectionDrag: null,

    /*
     * A feature being created by a held drag.
     *
     * Present while the pointer is down on a creation tool that takes
     * its two points from one press - a Line, a Rectangle, a Circle, a
     * span, a Point Force. It records which pointer owns the gesture, so
     * the release can commit the feature and the trailing click can be
     * swallowed. See creation-drag.js for the whole rule.
     */
    creationDrag: null,

    /*
     * Set when a drag-to-create gesture has just consumed its release, so
     * the `click` the browser fires afterwards is not read a second time
     * as the first point of a new feature. Cleared the moment it is read.
     */
    creationDragConsumedClick: false,

    panSession: null,

    /*
     * The pending expiry of a held snap guideline.
     *
     * A guideline is kept up briefly after the cursor leaves its
     * region so it does not flicker off with every small movement.
     * The pointer moving again would eventually clear it on its
     * own, but a cursor that stops moving just outside a region
     * would leave the guide up forever, so the hold is given a
     * deadline of its own.
     *
     * Only ever one timer: a new one replaces the old rather than
     * accumulating, so holding a guide steady does not queue up
     * dozens of redraws.
     */
    guidelineHoldTimer: null,

    drawingZoom: drawingState.camera.zoom * 100,

    /*
     * WHETHER THE TOP BAR IS FOLDED AWAY.
     *
     * A property of how someone is working rather than of the drawing they
     * are working on, so it lives here - on the running editor state - and
     * not in the document. It therefore survives redraws, tool changes and
     * window resizes, and is deliberately not saved into a file: reopening a
     * drawing should not reopen somebody else's layout.
     */
    topBarHidden: false,

    /*
     * Active direct-manipulation drag.
     *
     * Holds which handle (or body) of which object is being
     * dragged, plus the original geometry so the edit can be
     * applied as a delta from a stable starting point.
     */
    manipulationDrag: null,

    /*
     * Global toolbar tools.
     *
     * Modify tools act on the selected geometry using the
     * existing selection and history systems. View tools
     * only move the camera, so they never touch geometry.
     */
    /*
     * Active Modify session.
     *
     * A session holds the workflow the user is part way
     * through, so a Modify tool can span several clicks
     * (base point, pivot, mirror axis) and can be
     * cancelled cleanly at any stage.
     */
    modifySession: null,

    /*
     * THE CLIPBOARD
     *
     * Copy takes the current selection, paste creates it again as new
     * features, and cut does the two in order. They work through the
     * ordinary selection and the ordinary add path, so a pasted
     * feature is numbered, selectable and editable exactly as a
     * drawn one is, and every one of them is a single undoable
     * change.
     */
    drawingClipboard: null,

    eyedropperActive: false,

    /*
     * Global toolbar tools.
     *
     * Modify tools operate on the selected geometry;
     * View tools change only the camera. Both reuse the
     * existing selection, snapping and camera systems.
     */
    
    /*
     * The id of the global toolbar tool currently running,
     * so its button can stay visibly highlighted and be
     * cleared the moment the tool ends.
     */
    activeGlobalTool: null
};

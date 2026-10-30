/*
 * The editor's state: the document model, and the UI state shared between editor modules.
 */

import enggDrawingState from "../../shared/model/drawing-state.js";
import enggDrawingSnap from "../../shared/snapping/object-snap.js";
import enggSheets from "../../components/layout/workspace/sheets.js";

export const drawingState = enggDrawingState.createDrawingState();

/*
 * ============================================================
 * A COMMITTED DYNAMICS FEATURE
 * ============================================================
 *
 * The one entry point for adding a Dynamics symbol to the document, used by
 * the creation pipeline and by anything that places one directly (a test, an
 * automation hook). It delegates to the model's own builder - the same one the
 * live preview is made with - and then adds the single object that came out
 * and selects it, so a spring is one row in Objects, not a set of lines.
 *
 * NOT a second implementation: the builder, the mark and the name all come
 * from `dynamics-model.js`.
 *
 * THE MODEL IS IMPORTED LAZILY, BECAUSE A STATIC IMPORT IS A CYCLE.
 *
 * The Dynamics model reads `drawing-state.js`, and that module reaches back
 * here - so importing it at the top of this file evaluates the model while
 * `drawingState` is still uninitialised and every caller dies with "Cannot
 * access 'drawingState' before initialization". The model is therefore loaded
 * on first use, and the accumulated result is cached so the round trip
 * happens once rather than on every click.
 */
let dynamicsModel = null;
let dynamicsModelLoading = null;

/*
 * BEGIN LOADING THE MODEL, WITHOUT WAITING FOR IT.
 *
 * The click handlers that place a Dynamics feature are synchronous, so they
 * cannot await the first import. This starts the import at boot instead - once
 * for the whole session - and by the time a student has armed a tool and
 * clicked, the model is already resolved and `commitDynamicsFeature` can place
 * the feature in the same tick, exactly as a Line is placed.
 *
 * The PROMISE and the RESOLVED MODULE are kept apart. Storing the promise in
 * `dynamicsModel` would leave every synchronous commit looking at a pending
 * thenable and silently placing nothing.
 */
export function hydrateDynamics() {
    if (!dynamicsModelLoading) {
        dynamicsModelLoading = import("./dynamics/dynamics-model.js").then((model) => {
            dynamicsModel = model;

            return model;
        });
    }

    return dynamicsModelLoading;
}

async function loadDynamicsModel() {
    return dynamicsModel || (await hydrateDynamics());
}

/*
 * PLACE A DYNAMICS FEATURE NOW.
 *
 * Returns the committed object, or null when the model has not finished
 * loading or the builder declined the points. The creation pipeline calls
 * this, and treats a null as "nothing to commit" rather than as an error -
 * the model is loaded at boot, so null means the geometry was degenerate.
 */
export function commitDynamicsFeature(toolId, first, second, style = {}) {
    if (!dynamicsModel) {
        /*
         * NOT LOADED YET. Start it now so the next click succeeds, and report
         * honestly that this one placed nothing rather than throwing from a
         * pointer handler.
         */
        void hydrateDynamics();

        return null;
    }

    return commitDynamicsObject(
        toolId,
        dynamicsModel.createDynamicsObject(toolId, [first, second].filter(Boolean), style)
    );
}

export async function createDynamicsFeature(toolId, first, second, style = {}) {
    const model = await loadDynamicsModel();

    return commitDynamicsObject(
        toolId,
        model.createDynamicsObject(toolId, [first, second].filter(Boolean), style)
    );
}

/*
 * THE ONE PLACE A DYNAMICS OBJECT JOINS THE DOCUMENT.
 *
 * Whether the builder ran synchronously or behind the lazy import, the result
 * is stored the same way: named by its tool, refused while it is degenerate,
 * added once, and selected. Both commit paths call this, so a test and a click
 * can never produce objects that differ.
 */
function commitDynamicsObject(toolId, object) {
    if (!object) {
        return null;
    }

    /*
     * THE OBJECT'S TYPE IS THE TOOL'S. The readers of a stored feature ask
     * `type` which symbol it is, so a Dynamics object that kept an ordinary
     * type (a line, a circle) was a Dynamics object no check could find.
     */
    object.type = toolId;

    /*
     * AN ANCHOR SETTLED FROM A PART OF ITSELF IS NOT A LENGTH.
     *
     * A span tool whose hold has not yet been given its second end is handed
     * its first point twice, which would make the object degenerate - a
     * zero-length spring. It is refused here, where every caller passes
     * through, so the preview stays empty until the second point exists.
     */
    if (
        object.geometry?.start &&
        object.geometry?.end &&
        Math.hypot(
            Number(object.geometry.end.x) - Number(object.geometry.start.x),
            Number(object.geometry.end.y) - Number(object.geometry.start.y)
        ) < 1e-9
    ) {
        return null;
    }

    const added = enggDrawingState.addObject(drawingState, object);

    if (drawingState.selection) {
        drawingState.selection.selectedObjectIds = [object.id];
    }

    return added || object;
}

/*
 * The creation pipeline's name for the same operation. A Dynamics feature is
 * committed through one function, whether its points arrived as two clicks or
 * as a preview's own builder, so there is no second way to place one.
 */
export const createDynamicsCreation = createDynamicsFeature;

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

    /*
     * A TOUCH OR PEN PRESS, HELD UNTIL THE GESTURE IS CLASSIFIED.
     *
     * A mouse press is dispatched the moment it happens: a cursor cannot wobble
     * while it is held still. A finger can, so a touch press on an editing
     * target is recorded here first and only run once the shared gesture tracker
     * says the press travelled far enough to be a drag. A press that never
     * travels leaves the browser's own click to run the ordinary selection,
     * which is what a tap is.
     */
    touchPress: null,

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

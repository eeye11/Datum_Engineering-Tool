/*
 * ============================================================
 * THE DRAWING INSPECTOR (OBJECTS | FEATURES | SOURCE)
 * ============================================================
 *
 * Wires the right-side panel's three tabs to the page.
 *
 *  - Objects: a list of objects on the active sheet.
 *  - Features: the properties of whatever is selected - across every tool
 *    category - and empty when nothing is.
 *  - Source: the editable TikZ/LaTeX source that generates the drawing.
 */

import { renderEngineeringTools } from "../toolbar/toolbar-render.js";
import { activeCategory } from "../toolbar/tool-menus.js";
import { drawingState } from "../../../features/workspace/editor-state.js";
import enggDrawingState from "../../../shared/model/drawing-state.js";
import { activeSourceManager } from "../../../shared/rendering/latex/drawing-source-manager.js";
import { installSourceWriters } from "../../../shared/rendering/latex/source-writers/index.js";
import { mappedObjectIds } from "../../../shared/rendering/latex/source-mapping.js";
import {
    clearSourceGenerationProblem,
    clearSourceGenerationProblems,
    hasSourceGenerationProblem,
    sourceGenerationProblems
} from "../../../shared/rendering/latex/source-diagnostics.js";
import {
    addSourceWriter,
    removeObjectFromSource,
    reconcileSourceWithObjects,
    setSourceWriter,
    sourceForObject,
    writeObjectIntoSource
} from "../../../shared/rendering/latex/source-synchronization.js";
import { setSourceGeometryFactories } from "../../../shared/rendering/latex/source-object-sync.js";

import { drawingCanvas } from "../../../features/workspace/dom.js";
import { objectAtPoint } from "../../../features/workspace/interaction/hit-testing.js";
import { canvasPointFromEvent } from "../toolbar/tool-activation.js";

import { activePanelTab, installPanelTabs, setActivePanelTab } from "./panel-tabs.js";
import { installObjectsPane } from "./objects-pane.js";
import { installFeaturesPane, renderFeatures } from "./features-pane.js";
import { installSourceTab, refreshSourceSelection } from "./source-tab.js";
import { notifyDrawingChanged } from "./source-canvas-bridge.js";
import { requestSourceRender, renderCurrentDrawing } from "../workspace/canvas-render.js";

/* ============================================================
 * MODEL -> SOURCE SYNC
 * ============================================================
 *
 * Every committed edit arrives here, and this is the ONE place that decides what
 * the source has to do about it. It used to answer a narrower question - "write
 * the first selected object's region" - which left three things wrong:
 *
 *   A MULTI-OBJECT EDIT only reached one object. Selecting three lines and
 *   changing their colour updated one region and silently left two behind.
 *
 *   A DELETION removed nothing. The objects went from the model and their
 *   commands stayed in the source, so the next render - or the next reopen -
 *   brought them back. That is the orphaned-source defect, and it is why the
 *   answer has to consider what is MISSING as well as what changed.
 *
 *   A NEW OBJECT was written only if it happened to be selected. A tool that
 *   commits without selecting (a paste, an import) added nothing.
 *
 * SO THE SYNC IS A RECONCILIATION, NOT A PATCH. It is given the whole document
 * and it brings the source into agreement with it: regions for objects that
 * exist, no regions for objects that do not. It still edits IN PLACE through the
 * per-object writer, so the student's own formatting and any custom source are
 * preserved - what changed is which objects are considered, not how each one is
 * written.
 */

/*
 * The objects whose regions are currently in the source.
 *
 * Kept as a set rather than re-derived from the text on every commit, because a
 * removal needs to know what USED to be there: by the time the sink runs, the
 * deleted object is already gone from the model, so the only record of it is
 * this one.
 */
let sourceObjectIds = null;

function knownSourceIds(manager) {
    if (sourceObjectIds === null) {
        sourceObjectIds = new Set(mappedObjectIds(manager.getSource()));
    }

    return sourceObjectIds;
}

function syncSourceWithDrawing() {
    const manager = activeSourceManager();

    if (!manager) {
        return;
    }

    const objects = Array.isArray(drawingState.objects) ? drawingState.objects : [];
    const present = new Set(objects.map((object) => object.id));
    const previously = knownSourceIds(manager);

    /*
     * THE CONTEXT EVERY WRITER IS GIVEN.
     *
     * Some source is a function of more than the object: a dimension is drawn
     * against the geometry it measures, a diagram against the sheet that
     * carries it, and a vector's drawn length against the sheet's scale. The
     * writers are handed the sheet and the whole object list so they can read
     * those facts, exactly as the canvas renderer does. It is a read-only
     * context - a writer that mutated the drawing would be able to start the
     * loop this pipeline is careful not to have.
     */
    const context = {
        state: drawingState,
        allObjects: objects
    };

    let changed = false;

    /*
     * ONE OBJECT AT A TIME, IN PLACE. A region is rewritten through the object's
     * own writer and nothing else in the text is touched, so a full regeneration
     * - which would discard the student's formatting - never happens here.
     */
    objects.forEach((object) => {
        if (sourceForObject(object, context) === null) {
            /*
             * A WRITER TRIED AND FAILED. The object's previous block describes
             * geometry the object no longer has, so it is taken out rather than
             * left drawing the old shape - Source and the Drawing Space must not
             * show an object the model has moved on from. The failure itself is
             * named in the Source tab's diagnostics. An object no writer claims
             * at all is not touched: its region is the student's own content.
             */
            if (hasSourceGenerationProblem(object.id) && removeObjectFromSource(manager, object.id)) {
                changed = true;
                previously.delete(object.id);
            }

            return;
        }

        if (writeObjectIntoSource(manager, object, context)) {
            changed = true;
            previously.add(object.id);
        }
    });

    /*
     * AND EVERY OBJECT THAT IS NO LONGER THERE LOSES ITS REGION.
     *
     * This is the half that was missing. A deleted feature whose commands stayed
     * in the source is a feature that comes back on the next render, so the
     * source has to be told - and it is told by IDENTITY, not by line number, so
     * a neighbour sharing a line or a block is never caught up in it.
     */
    [...previously].forEach((id) => {
        if (present.has(id)) {
            return;
        }

        if (removeObjectFromSource(manager, id)) {
            changed = true;
        }

        previously.delete(id);
    });

    /*
     * A DELETED OBJECT IS NO LONGER MISSING FROM THE SOURCE - it is gone. Its
     * report is cleared whether or not it still had a region, because an
     * object that could not be written had its region taken out above.
     */
    sourceGenerationProblems().forEach(({ id }) => {
        if (!present.has(id)) {
            clearSourceGenerationProblem(id);
        }
    });

    /*
     * THE MAP IS REBUILT FROM THE TEXT, NOT REMEMBERED.
     *
     * `manager.map()` parses the current source on demand, so the selection
     * highlight - which resolves each selected object's region through that map -
     * already follows the new text the moment it is asked. There is nothing here
     * to invalidate, and a `refresh` call would be a second mechanism for a job
     * the map does by construction.
     */
    void changed;
}

function handleObjectCommitted() {
    syncSourceWithDrawing();

    /*
     * AND THE CANVAS SHOWS THE MODEL AGAIN. A rendered source covers the model's
     * drawing while the student is working in Source; the moment they change the
     * drawing that overlay is a picture of the OLD source, so it is taken down
     * and the sheet is drawn from the objects. See `notifyDrawingChanged`.
     */
    notifyDrawingChanged();
}

/*
 * A SHEET LOAD, AN UNDO OR A REDO REPLACES THE OBJECTS WHOLESALE, so the record
 * of what the source holds is no longer about this document. Forgetting it makes
 * the next sync re-read the source rather than trying to remove regions for
 * objects that belong to a drawing the student has left.
 */
export function forgetSourceObjectIds() {
    sourceObjectIds = null;
}

function managerRevision() {
    return activeSourceManager().revision();
}

/*
 * A REPLACEMENT OF THE WHOLE OBJECT SET IS NOT AN EDIT TO ONE OBJECT.
 *
 * Undo, Redo and a sheet load all swap the document's objects for another set.
 * The reconciliation above is written for an EDIT - it adds and removes regions
 * one at a time, and it deliberately never regenerates the document, because
 * that would discard the student's formatting.
 *
 * That is the wrong shape for a wholesale replacement, and it shows: undoing a
 * deletion has to bring the deleted commands BACK, and there is no per-object
 * edit that expresses "this region should exist again" - the source simply no
 * longer describes the document. So a replacement is answered by asking the
 * source to represent the objects it is now given, which is the one place a
 * rebuild is allowed.
 */
function handleObjectsReplaced() {
    const manager = activeSourceManager();

    /*
     * A REPLACEMENT IS NOT AN EDIT, SO THE RECONCILIATION RUNS AT ONCE. Undo,
     * Redo and a sheet load can bring a deleted object BACK, and the per-object
     * edit path has no way to say "this region should exist again" - only a
     * rebuild of the regions the source is missing can. It ADDS only, so custom
     * source and every surviving object's own formatting are untouched.
     */
    if (manager) {
        sourceObjectIds = null;

        /* The problems recorded were about the objects that were replaced. */
        clearSourceGenerationProblems();

        reconcileSourceWithObjects(manager, drawingState.objects || [], { state: drawingState });

        knownSourceIds(manager);
    }

    /*
     * AND THE SELECTION'S HIGHLIGHT IS RESOLVED AGAIN, because the text it was
     * resolved against has been rewritten. Features and Objects already follow
     * the announcement themselves; the source editor is told here so it does not
     * depend on the tab having been open at the time.
     */
    refreshSourceSelection();
}

/* ============================================================
 * CONTEXTUAL NAVIGATION
 * ============================================================ */

function handleToolChanged() {
    renderEngineeringTools(activeCategory());
    renderCurrentDrawing();
    renderFeatures();
}

/*
 * SELECTING SOMETHING OPENS ITS FEATURES.
 *
 * The tab follows the SELECTION, not the tool: an armed tool has no properties
 * here, so activating one must not open an empty panel. Choosing an object - on
 * the canvas or in the Objects list - is a request to see it, and Features is
 * where it is shown. Deselecting leaves the tab where it is, because an empty
 * Features tab is the honest answer and taking the student away from Objects
 * when they click empty canvas would be worse.
 */
function handleSelectionChanged(event) {
    const ids = event?.detail?.objectIds || drawingState.selection.selectedObjectIds;

    if (ids && ids.length && activePanelTab() === "objects") {
        setActivePanelTab("features");
    }
}

function handleTabChanged(event) {
    const tab = event?.detail?.tab;

    if (tab === "features") {
        renderFeatures();
    }
}

/*
 * DOUBLE-CLICKING AN ALREADY-SELECTED OBJECT OPENS ITS FEATURES.
 *
 * The canvas's own double-click gesture is owned by its editor module - a
 * dimension opens its value box, a note its text editor - and this must not
 * duplicate any of that. So it listens to the gesture the canvas already makes
 * and asks one question the canvas has already answered: is the object under
 * the pointer ALREADY selected? If it is, the student has picked the thing and
 * double-clicked it, which is the application's "open this" gesture, and
 * Features is where an object is opened.
 *
 * It runs on capture, so it still fires for an object whose own double-click
 * editor stops the event - the tab change is harmless beside opening a value
 * box, and the student sees the same properties either way.
 *
 * It deliberately does NOT create a selection. A double-click on an unselected
 * object is a plain click followed by nothing special, and selecting it is the
 * canvas's existing click path's job.
 */
function handleCanvasDoubleClick(event) {
    if (event.detail < 2 || activePanelTab() === "features") {
        return;
    }

    const pointed = objectAtPoint(canvasPointFromEvent(event, false));

    /*
     * THE HIT TEST'S OWN OBJECT IS COMPARED - not a re-lookup of the selection -
     * so "is this already selected" is asked of the SAME object the canvas
     * picked, and the two cannot disagree about what is under the pointer.
     */
    const selectedIds = drawingState.selection?.selectedObjectIds || [];

    if (!pointed || !selectedIds.includes(pointed.id)) {
        return;
    }

    setActivePanelTab("features");
}

/*
 * A CONSTRUCTION SETTING THAT CHANGES THE SHAPE MUST REACH THE PREVIEW.
 *
 * The polygon's side count is read from the interaction every frame, so the
 * setting is written there while that construction is running. Without this the
 * student could ask for seven sides, watch the preview stay six, and only find
 * out when they released the drag.
 *
 * Only a setting the interaction already carries is copied, so a setting with
 * no runtime meaning cannot invent one. The interaction is not a history entry
 * until the shape is committed, so writing it here records nothing.
 */
const CONSTRUCTION_SETTING_KEYS = {
    polygon: { sides: "polygonSides" }
};

function handleToolSettingChanged(event) {
    const detail = event?.detail || {};
    const mapping = CONSTRUCTION_SETTING_KEYS[detail.toolId];

    if (!mapping || !Object.prototype.hasOwnProperty.call(mapping, detail.key)) {
        return;
    }

    const interaction = drawingState.interaction;

    if (!interaction || interaction.phase === "idle") {
        return;
    }

    interaction[mapping[detail.key]] = detail.value;

    globalThis.document.dispatchEvent(
        new (globalThis.document.defaultView?.CustomEvent || Event)("datum:drawing-changed")
    );
}

/* ============================================================
 * INSTALL
 * ============================================================ */

export function installDrawingPanel() {
    installPanelTabs();
    installObjectsPane();
    installFeaturesPane();
    installSourceTab();

    /*
     * REGISTER EVERY CATEGORY'S WRITER, FROM THE ONE LIST.
     *
     * Geometry and Statics used to be named here by hand, which worked while
     * they were the only two and is exactly why the other categories had
     * objects that never reached Source: a writer that exists but is never
     * installed is not part of the pipeline. The list in `source-writers/index.js`
     * is now the only place a category is added, and it is installed whole.
     */
    installSourceWriters({ addSourceWriter, setSourceWriter });

    /*
     * AND THE SOURCE READER'S FACTORIES. A statement typed in Source becomes an
     * object through the SAME geometry factories a tool uses, so the object it
     * creates has the model's own fields, defaults and label rather than a shape
     * invented by the parser.
     */
    setSourceGeometryFactories(enggDrawingState.geometryFactories);

    /* Let committed model edits patch just their own source region. */
    enggDrawingState.setSourceSink(handleObjectCommitted);

    /*
     * ============================================================
     * THE SOURCE IS THE PICTURE, SO EVERY SOURCE CHANGE IS A DRAW
     * ============================================================
     *
     * The one subscription that makes the Drawing Space follow the Source. It
     * is on the MANAGER, not on the editor, so it covers every origin of a
     * change equally: a tool committing an object, a property edit, a delete,
     * an Undo, a sheet load, and the student typing in Source.
     *
     * The compile is debounced and revision-checked in `canvas-render.js`, so
     * a pointer drag that rewrites the source on every move does not queue a
     * document compile per event, and an older compile's result is discarded
     * if a newer edit has already arrived.
     */
    let lastSourceRevision = managerRevision();

    activeSourceManager().subscribe(() => {
        const revision = managerRevision();

        if (revision === lastSourceRevision) {
            return;
        }

        lastSourceRevision = revision;

        requestSourceRender();
    });

    globalThis.document.addEventListener("datum:tool-changed", handleToolChanged);
    globalThis.document.addEventListener("datum:selection-changed", handleSelectionChanged);
    globalThis.document.addEventListener("datum:panel-tab-changed", handleTabChanged);

    /* The canvas's "open this" gesture, without owning it. */
    if (drawingCanvas) {
        drawingCanvas.addEventListener("dblclick", handleCanvasDoubleClick, true);
    }
    globalThis.document.addEventListener("datum:tool-setting-changed", handleToolSettingChanged);

    /*
     * AN UNDO, A REDO OR A SHEET LOAD REPLACES THE OBJECTS, and the source is
     * asked to represent the set it is given rather than to patch a region.
     */
    globalThis.document.addEventListener("datum:drawing-replaced", handleObjectsReplaced);

    renderFeatures();
}

export default {
    installDrawingPanel,
};

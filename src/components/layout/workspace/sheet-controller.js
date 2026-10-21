/*
 * Sheets as the editor sees them: switching, creating, renaming, reordering, deleting, and the references other parts of the app hold to them.
 */

import enggDrawingState from "../../../shared/model/drawing-state.js";
import enggDrawingReference from "../../../shared/references/drawing-reference.js";
import enggDrawingRenderer from "../../../shared/rendering/renderer.js";
import enggSheetTabs from "./sheet-tabs.js";
import enggSheets from "./sheets.js";
import enggUi from "../../../shared/ui/ui.js";
import { renderCurrentDrawing } from "./canvas-render.js";
import { markDocumentDirty, serializeDocumentBody } from "../../../features/workspace/commands/document-commands.js";
import { drawingCanvas, drawingDisplayToggles, drawingGridToggle, drawingSnapToggle, drawingZoomValue } from "../../../features/workspace/dom.js";
import { drawingState, editorState } from "../../../features/workspace/editor-state.js";
import { renderProperties } from "../panels/feature-panel.js";
import { defaultLineColour } from "./theme.js";
import { setToolMessage } from "../toolbar/toolbar-render.js";

const drawingSheetBar =
    globalThis.document?.getElementById("drawingSheetTabs");

/*
 * ========================================================
 * THE DEFAULT DRAWING COLOUR OF A LOADED SHEET
 * ========================================================
 *
 * A sheet carries its own `styleDefaults.stroke`. The rule is:
 *
 *   1. the student HAS chosen a colour - the stored value is kept, whatever the
 *      theme, because it is the student's own choice;
 *   2. otherwise the stroke is the THEME's default, so it is re-pointed to the
 *      theme in effect now. A sheet saved under the light theme therefore opens
 *      with the right default line colour under the dark one.
 *
 * WHAT COUNTS AS "CHOSEN" is `strokeExplicit === true` - the flag the colour
 * picker sets. A file saved BEFORE the flag existed has none, and its stroke is
 * judged by its VALUE: the old fixed default was `#000000`, so that value means
 * "no explicit choice" and any other does not. A document someone deliberately
 * drew in red keeps its red; a document that never chose one moves to the new
 * theme default with everything else.
 *
 * ONLY THE DEFAULT FOR FUTURE FEATURES IS TOUCHED. This returns a new defaults
 * object and never walks `objects`, so existing features keep the strokes they
 * were drawn with - a theme change must not recolour the drawing.
 */
export function adoptDefaultStroke(styleDefaults = {}) {
    const loaded = { ...styleDefaults };

    const legacyDefault = loaded.stroke === "#000000";

    const chosenByStudent =
        loaded.strokeExplicit === true ||
        (loaded.strokeExplicit === undefined && !legacyDefault);

    if (!chosenByStudent) {
        loaded.stroke = defaultLineColour();
        loaded.strokeExplicit = false;
    }

    return loaded;
}

export function sheetById(sheetId) {
    return enggSheets.sheetById(
        editorState.sheetCollection,
        sheetId
    );
}

export function activeSheet() {
    return enggSheets.activeSheet(
        editorState.sheetCollection
    );
}

/*
 * ========================================================
 * THE SHEET COLLECTION, IN THE DOCUMENT HISTORY
 * ========================================================
 *
 * The editor is the LIVE COPY of the active sheet and the collection sits
 * beside it, so the history cannot reach the collection on its own. These
 * three functions are how it does.
 *
 * Without them, Undo restored the objects on screen and nothing else:
 * adding a sheet, renaming one, reordering them and deleting one were all
 * invisible to Undo, and deleting a sheet took its features with it
 * permanently - which is the worst version of that bug, because the
 * features were not recoverable from anywhere.
 *
 * `capture` is taken BEFORE a sheet operation and `restore` is reached
 * through the same commit every drawing edit uses, so a sheet change is
 * ONE history entry like any other - not a special case, and not a second
 * stack.
 *
 * THE SHEET MODULE'S OWN SERIALISER IS USED FOR BOTH DIRECTIONS.
 *
 * `serializeCollection` already deep-copies every sheet and keeps the
 * active id, and `createCollection` already accepts that shape and
 * normalises whatever it is given. Re-implementing either here would be a
 * second opinion about what a sheet is - and the first attempt at this
 * called three functions that do not exist, which threw inside
 * `snapshotDrawing` and therefore broke EVERY edit in the application,
 * because a snapshot is taken on the click that places every feature.
 */
function captureSheetsForHistory() {
    return enggSheets.serializeCollection(
        editorState.sheetCollection
    );
}

function restoreSheetsFromHistory(captured) {
    if (!captured) {
        return;
    }

    editorState.sheetCollection =
        enggSheets.createCollection(
            captured
        );

    refreshSheetTabs();
    renderCurrentDrawing();
    renderProperties();
}

function adoptSheetViewportIntoEditor() {
    const sheet = activeSheet();

    if (!sheet) {
        return;
    }

    /*
     * A SHEET IS ITS OWN CONTENT - it is stored flat, which is what a
     * saved file looks like - so its viewport and settings are read off it
     * directly rather than through a separate accessor that does not exist.
     */
    Object.assign(drawingState.camera, sheet.viewport);
    drawingState.snap = { ...sheet.snap };
    drawingState.objectSnap = { ...sheet.objectSnap };

    drawingState.styleDefaults = adoptDefaultStroke(sheet.styleDefaults);

    /*
     * GRID SNAP ARRIVES WITH THE SHEET, RESOLVED IN ONE PLACE.
     *
     * `resolveGridSnap` is where a sheet with no recorded grid-snap state is
     * given one, so this adopts the answer rather than repeating the rule. Two
     * copies of the same fallback would be two chances for them to disagree.
     */
    drawingState.grid = enggSheets.resolveGridSnap({ ...sheet.grid });

    drawingState.units = sheet.units;

    /*
     * AND THE EDITOR TAKES THE SHEET'S FEATURES, because the editor is
     * the live copy of whichever sheet is active and the objects restored
     * immediately before this are the active sheet's.
     */
    enggSheets.applySheetContent(
        sheet,
        enggSheets.captureSheetContent(
            drawingState
        )
    );
}

/*
 * Write the editor's current drawing back onto the active sheet.
 *
 * Called before anything that leaves the sheet - switching, saving,
 * recovering - so that what the student sees is always what the sheet
 * holds. It is the only place the two are kept in step, which is what
 * makes it safe for the editor to be the live copy.
 *
 * The sheet's UNITS go back the same way they arrived, so the editor never
 * carries a setting the sheet does not have.
 */
export function syncActiveSheet() {
    const sheet = activeSheet();

    if (!sheet) {
        return;
    }

    enggSheets.applySheetContent(
        sheet,
        enggSheets.captureSheetContent(
            drawingState
        )
    );

    sheet.units = drawingState.units;
}

/*
 * Write the editor's current drawing back onto the active sheet.
 *
 * Called before anything that leaves the sheet - switching, saving,
 * recovering - and after every committed edit, so that what the
 * student sees is always what the sheet holds. It is the only place
 * the two are kept in step, which is what makes it safe for the
 * editor to be the live copy.
 */
/*
 * Make a sheet the one being edited.
 *
 * The outgoing sheet is saved first, so a switch always leaves the
 * sheet it came from exactly as the student left it - including its
 * own zoom and its own pan. Then the incoming sheet is loaded, which
 * also brings its grid, its snapping and its style defaults with it.
 *
 * The active tool is NOT carried over conceptually: it is simply left
 * as it is, because a tool is a property of the session rather than of
 * a sheet, and a student moving from their beam to their free body
 * diagram almost always wants the same tool ready. What IS discarded
 * is any interaction in progress - a half-drawn line, a running drag -
 * because it belongs to geometry that is no longer on screen.
 */
function activateSheet(sheetId) {
    const target = sheetById(sheetId);

    if (!target) {
        return false;
    }

    if (target.id === editorState.sheetCollection.activeSheetId) {
        return true;
    }

    syncActiveSheet();

    editorState.sheetCollection.activeSheetId = target.id;

    enggSheets.loadSheet(drawingState, target);

    /*
     * The zoom readout belongs to the viewport, and the viewport is
     * now the new sheet's. Leaving it at the previous sheet's value
     * would report a zoom the user is not looking at.
     */
    editorState.drawingZoom =
        drawingState.camera.zoom * 100;

    if (drawingZoomValue) {
        drawingZoomValue.value =
            `${Math.round(editorState.drawingZoom)}%`;
    }

    enggDrawingState.clearInteraction(
        drawingState
    );

    syncWorkspaceSettingToggles();

    markDocumentDirty();

    refreshSheetTabs();

    renderProperties();
    renderCurrentDrawing();

    notifyReferences();

    setToolMessage(
        target.name
    );

    return true;
}

function createSheet(options = {}) {
    syncActiveSheet();

    const sheet = enggSheets.addSheet(
        editorState.sheetCollection,
        options
    );

    loadSheetIntoEditor(sheet);

    markDocumentDirty();

    refreshSheetTabs();

    renderProperties();
    renderCurrentDrawing();

    notifyReferences();

    setToolMessage(
        `Created ${sheet.name}`
    );

    return sheet;
}

/*
 * Put a sheet into the editor and make it active.
 *
 * Separate from activateSheet because the new sheet is not in the
 * editor yet, so there is nothing to save back out of it - and saving
 * would be wrong, not merely redundant: it would write the PREVIOUS
 * sheet's content over the new one.
 */
export function loadSheetIntoEditor(sheet) {
    enggSheets.loadSheet(drawingState, sheet);

    /*
     * The zoom comes back through the shared sanitiser.
     *
     * A sheet stores the zoom it was left at, and that value was
     * sanitised when it was set - but it was also read from a file, and
     * a file is editable. Re-applying it through the one function the
     * application already uses means a restored viewport is clamped
     * and rounded exactly as a zoomed one is, so no sheet can come
     * back at 100.0000001% or 4000% because a hand-edited file said so.
     *
     * The sheet's own stored value is left alone: it is the
     * application that decides what a zoom means, not the file.
     */
    enggDrawingState.setCameraZoom(
        drawingState,
        drawingState.camera.zoom
    );

    enggDrawingState.clearInteraction(
        drawingState
    );

    syncWorkspaceSettingToggles();

    editorState.drawingZoom =
        drawingState.camera.zoom * 100;

    if (drawingZoomValue) {
        drawingZoomValue.value =
            `${Math.round(editorState.drawingZoom)}%`;
    }
}

/*
 * ========================================================
 * STATING A TOGGLE'S ON/OFF STATE
 * ========================================================
 *
 * The GRID/SNAP and DISPLAY toggles are ICON-ONLY, so there is no word beside
 * them to update. The state is carried by three things that ARE there:
 *
 *   the button's `aria-pressed` attribute   - the state, for a screen reader
 *   the `.active` class                    - the state, visually
 *   the button's `title`                   - "Grid: on" / "Grid: off", on hover
 *
 * THE TOOLTIP IS THE ONE THAT REPLACED THE LABEL, and it is not just cosmetic:
 * an icon-only toggle whose only explanation was a tooltip reading "Grid" would
 * say WHAT it is but not WHICH WAY IT IS - so the word ON/OFF has to travel with
 * it. That is this function's whole job.
 *
 * IT NO LONGER WRITES TEXT INTO THE BUTTON. `textContent = "..."` replaces every
 * child, so the old implementation deleted the icon and left a bare word where a
 * symbol had been - the exact failure it was written to avoid. There is no text
 * node to find in an icon-only button, so writing one is not attempted.
 *
 * It is one function because several places state a toggle's ON/OFF - this
 * module, the toolbar's own handler and the settings dialog - and several copies
 * of "which node is the label" would be several chances to get it wrong.
 */
export function setToggleLabel(button, word, on) {
    if (!button) {
        return;
    }

    const state = on ? "on" : "off";

    button.classList.toggle("active", Boolean(on));
    button.setAttribute("aria-pressed", String(Boolean(on)));
    button.setAttribute("title", `${word}: ${state}`);
    button.setAttribute("aria-label", `${word}: ${state}`);

    /*
     * A button that IS purely text - an older panel, a test harness - has no
     * icon to preserve, so its visible text is kept in step as well. An
     * icon-only toggle has no text node, and nothing is written.
     */
    const labelNode = [...button.childNodes]
        .reverse()
        .find(
            (node) =>
                node.nodeType === 3 &&
                node.textContent.trim()
        );

    if (labelNode) {
        labelNode.textContent = ` ${word} ${on ? "ON" : "OFF"}`;
    }
}

/*
 * The Grid and Snap buttons state themselves from the editor rather
 * than from a variable of their own, so that a sheet arriving with
 * its grid off or its snapping off shows that immediately.
 */
export function syncWorkspaceSettingToggles() {
    if (drawingGridToggle) {
        /*
         * THE TOGGLE STATES ITSELF from the editor rather than from a variable
         * of its own, so a sheet arriving with its grid off shows that
         * immediately. `setToggleLabel` writes the active class, the pressed
         * state and the ON/OFF tooltip together, so the three cannot drift.
         */
        setToggleLabel(
            drawingGridToggle,
            drawingGridToggle.dataset.toggleName || "Grid",
            Boolean(drawingState.grid.visible)
        );
    }

    if (drawingCanvas) {
        drawingCanvas.classList.toggle(
            "grid-off",
            !drawingState.grid.visible
        );
    }

    if (drawingSnapToggle) {
        setToggleLabel(
            drawingSnapToggle,
            drawingSnapToggle.dataset.toggleName || "Snap",
            Boolean(drawingState.snap.enabled)
        );
    }

    /*
     * THE THREE DISPLAY SETTINGS STATE THEMSELVES, from the state.
     *
     * Read back rather than assumed, for the same reason as Grid and Snap:
     * a sheet arriving with them off has to show that immediately, or the
     * toolbar claims a setting the drawing is not using.
     *
     * AN ABSENT `display` READS AS ALL ON. That is the same rule the
     * annotation model applies, and it has to be the same rule - a toolbar
     * reading a state object one way while a label reads it another way is
     * how a drawing ends up with units showing that the toolbar says are
     * off.
     */
    /*
 * Both of the remaining settings are plain booleans read the same way.
 *
 * `showUnits` used to be special-cased here, defaulting to ON while its stored
 * value said otherwise, so that a drawing saved with units hidden still showed
 * them. There is no longer a button that can turn them off - a unit is part of
 * what the number means - so the state object has nothing left to disagree
 * about and every toggle is read the one way.
 */
    drawingDisplayToggles.forEach(({ button, key }) => {
        if (!button) {
            return;
        }

        const on = drawingState.display?.[key] !== false;

        /*
         * THE NAME COMES FROM THE BUTTON, not from its text.
         *
         * The toggle is ICON-ONLY, so there is no trailing text node to read a
         * word back from - and deriving it from the markup would find the icon
         * and nothing else. `data-toggle-name` in the markup is the one place
         * the name is written, and `setToggleLabel` uses it for the tooltip and
         * the accessible name.
         */
        setToggleLabel(
            button,
            button.dataset.toggleName || key,
            on
        );
    });
}

/*
 * ============================
 * SHEET COMMANDS
 * ============================
 */

/*
 * Rename, in the application's own dialog.
 *
 * NOT window.prompt, and this is a deliberate difference from how the
 * file panel is done. The save panel is the OPERATING SYSTEM's, and
 * reusing it would be right because a file's location is the system's
 * business. A sheet name is the application's business: it belongs to
 * DAETUM's document model, it is edited constantly, and a system
 * text box in the middle of a canvas is both foreign-looking and
 * impossible to style. So the two deliberately use different mechanisms,
 * each the one that fits.
 *
 * The sheet stays active while the dialog is open, and the id is not
 * touched. Any reference to this sheet - in the written solution, in a
 * caption - keeps working, because it never knew the name.
 */
function renameSheet(sheetId) {
    const sheet = sheetById(sheetId);

    if (!sheet) {
        return;
    }

    enggUi
        .promptDialog(
            "Give this sheet a name. " +
            "References to it are unaffected.",
            {
                title: "Rename sheet",
                fields: [
                    {
                        name: "name",
                        label: "Sheet name",
                        value: sheet.name,
                        placeholder: "Free Body Diagram",
                        maxLength: 80
                    }
                ],
                confirm: "Rename",
                cancel: "Cancel",

                /*
                 * An empty name would leave a tab with nothing on it,
                 * which is not a name and is impossible to tell apart
                 * from a broken tab. Returning false keeps the dialog
                 * open with the text still there, so the student can
                 * fix it rather than having lost their typing.
                 */
                onConfirm: (entered) =>
                    (entered.name || "").trim()
                        ? entered
                        : false
            }
        )
        .then((entered) => {
            if (!entered) {
                return;
            }

            const renamed = enggSheets.renameSheet(
                editorState.sheetCollection,
                sheetId,
                entered.name
            );

            if (!renamed) {
                return;
            }

            markDocumentDirty();

            refreshSheetTabs();

            /*
             * The name is shown in figure captions, so a rename is a
             * change the written side can see.
             */
            notifyReferences();

            setToolMessage(
                `Renamed to ${renamed.name}`
            );
        });
}

function duplicateSheet(sheetId) {
    syncActiveSheet();

    const copy = enggSheets.duplicateSheet(
        editorState.sheetCollection,
        sheetId
    );

    if (!copy) {
        return;
    }

    loadSheetIntoEditor(copy);

    markDocumentDirty();

    refreshSheetTabs();

    renderProperties();
    renderCurrentDrawing();

    notifyReferences();

    setToolMessage(
        `Duplicated as ${copy.name}`
    );
}

/*
 * Delete a sheet, after checking the user means it.
 *
 * A sheet is a whole drawing. Deleting one is not a misclick away from
 * a mistake of the same size as pressing Delete with a feature
 * selected - it can be the whole of a student's shear force diagram -
 * so an empty sheet is removed immediately and a sheet WITH something
 * on it always asks first.
 *
 * The last sheet is never removed. There would be nothing left to
 * draw on, and a document with no sheets cannot be saved, recovered
 * or referenced.
 */
async function deleteSheet(sheetId) {
    const sheet = sheetById(sheetId);

    if (!sheet) {
        return;
    }

    if (editorState.sheetCollection.sheets.length <= 1) {
        setToolMessage(
            "The last sheet cannot be deleted"
        );

        return;
    }

    if (
        sheet.objects.length &&
        !(await enggUi.confirmDialog(
            "This sheet contains drawing content.\n\n" +
            `Delete "${sheet.name}"?\n\n` +
            "The drawing on it cannot be recovered.",
            {
                title: "Delete sheet",
                confirm: "Delete",
                cancel: "Cancel"
            }
        ))
    ) {
        return;
    }

    const wasActive =
        editorState.sheetCollection.activeSheetId === sheetId;

    if (!enggSheets.deleteSheet(
        editorState.sheetCollection,
        sheetId
    )) {
        return;
    }

    if (wasActive) {
        const next = activeSheet();

        loadSheetIntoEditor(next);
    }

    markDocumentDirty();

    refreshSheetTabs();

    renderProperties();
    renderCurrentDrawing();

    notifyReferences();

    setToolMessage(
        `Deleted ${sheet.name}`
    );
}

function moveSheet(sheetId, delta) {
    if (
        !enggSheets.moveSheet(
            editorState.sheetCollection,
            sheetId,
            delta
        )
    ) {
        return;
    }

    markDocumentDirty();

    refreshSheetTabs();

    notifyReferences();
}

function reorderSheet(sheetId, targetIndex) {
    if (
        !enggSheets.reorderSheet(
            editorState.sheetCollection,
            sheetId,
            targetIndex
        )
    ) {
        return;
    }

    markDocumentDirty();

    refreshSheetTabs();

    notifyReferences();
}

/*
 * The tab bar.
 *
 * Attached once and re-rendered from the collection, so the tabs and
 * the document cannot disagree: there is one source of truth and the
 * bar is a view of it.
 */
export function refreshSheetTabs() {
    if (!drawingSheetBar || !enggSheetTabs) {
        return;
    }

    enggSheetTabs.render();
}

/*
 * ============================
 * REFERENCES
 * ============================
 */

/*
 * Told whenever the drawing changes in a way a figure would show.
 *
 * A reference is live: it renders from the sheet's current contents
 * every time it is looked at. The written side keeps a canvas to draw
 * into, so it has to be told when that drawing is now out of date -
 * and it must be told from the ONE place that knows, rather than from
 * each of the many code paths that can change a drawing.
 */
let onReferencesChanged = null;

export function notifyReferences() {
    if (
        typeof onReferencesChanged === "function"
    ) {
        onReferencesChanged();
    }
}

/*
 * The document as the rest of the application sees it.
 *
 * Published so that the written solution - or anything else that needs
 * to point at a sheet - can ask for a figure without reaching into the
 * editor's internals. It exposes sheets by ID and nothing that could
 * be mistaken for authority over them.
 */
export const enggDrawingSheets = {
    get collection() {
        return editorState.sheetCollection;
    },
    /* The prefix every sheet id is minted with; one source, so a caller that
       needs to name a sheet before creating it (Enter Drawing) mints an id the
       sheet factory will keep rather than replace. */
    get sheetIdPrefix() {
        return enggSheets.SHEET_ID_PREFIX;
    },
    activeSheet,
    activeSheetId: () => editorState.sheetCollection.activeSheetId,
    activateSheet,
    all: () => editorState.sheetCollection.sheets,
    createSheet,
    deleteSheet,
    duplicateSheet,
    moveSheet,
    renameSheet,
    reorderSheet,
    renderReference(sheetId, options) {
        return enggDrawingReference.renderDrawingReference(
            sheetId,
            options
        );
    },
    setReferenceChangeHandler(handler) {
        onReferencesChanged =
            typeof handler === "function"
                ? handler
                : null;
    },
    sheetById,

    /*
     * The document as it would be written to a file.
     *
     * Exposed so that anything which needs to persist or inspect the
     * whole document - the file itself, the recovery copy, a check
     * that a document really does contain what it should - reads it
     * from the one place that builds it, rather than assembling its
     * own version and risking a second, subtly different shape.
     */
    serializeDocumentBody
};

export const enggDrawing = {
    state: drawingState,
    model: enggDrawingState,
    renderer: enggDrawingRenderer
};

/*
 * Wire this part of the editor to the page. Called once, at start-up,
 * by editor/index.js.
 */
export function installSheetController() {
    enggDrawingState.setHistorySinks(
        drawingState,
        {
            capture: captureSheetsForHistory,
            restore: restoreSheetsFromHistory,
            adopt: adoptSheetViewportIntoEditor
        }
    );

    enggSheetTabs.attach(drawingSheetBar, {
        getSheets: () => editorState.sheetCollection.sheets,
        getActiveSheetId: () =>
            editorState.sheetCollection.activeSheetId,
        onActivate: activateSheet,
        onCreate: () => createSheet(),
        onRename: renameSheet,
        onDuplicate: duplicateSheet,
        onDelete: deleteSheet,
        onMove: moveSheet,
        onReorder: reorderSheet
    });
}

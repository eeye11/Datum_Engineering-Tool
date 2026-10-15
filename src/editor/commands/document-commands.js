/*
 * New, Open, Save, Save As, Print and export, and crash recovery.
 */

import enggDrawingState from "../../core/model/drawing-state.js";
import enggErrorLog from "../../app/error-log.js";
import enggDrawingExport from "../../file/document-export.js";
import enggDocumentFile from "../../file/document-file.js";
import enggDocumentManagement from "../../file/document-management.js";
import { LATEX_EXTENSION, LATEX_MEDIA_TYPE, hasEmbeddedDocument, readEmbeddedEnvelope, writeLatexDocument } from "../../file/latex/latex-document.js";
import { openLatexCodeEditor } from "./latex-commands.js";
import enggRecovery from "../../file/document-recovery.js";
import enggFileSave from "../../file/file-save.js";
import enggRecentFiles from "../../file/recent-files.js";
import enggTemplates from "../../file/templates.js";
import enggDrawingReference from "../../references/drawing-reference.js";
import enggSheets from "../../sheets/sheets.js";
import enggOpenPopup from "../../ui/open-popup.js";
import enggUi from "../../ui/ui.js";
import enggSolutionState from "../../solution/solution-state.js";
import { renderCurrentDrawing } from "../workspace/canvas-render.js";

/*
 * The workspace's own "load this source" function, registered by the workspace
 * when it installs.
 *
 * IT IS A REGISTRATION, NOT AN IMPORT, and that is deliberate. The workspace
 * already reaches this module (it renders through `written-references`, and the
 * preview needs the sheet facade), so importing it back would close a cycle that
 * the module-graph test exists to prevent. A registration has no such edge: the
 * workspace is optional - a page can have the API and the drawings without the
 * solution tab - and this stays null there, which the call site checks.
 */
let loadSolutionSource = null;

export function attachSolutionLoader(loader) {
    loadSolutionSource = typeof loader === "function" ? loader : null;
}
import { drawingState, editorState } from "../editor-state.js";
import { renderProperties } from "../panels/feature-panel.js";
import { activeSheet, loadSheetIntoEditor, notifyReferences, refreshSheetTabs, sheetById, syncActiveSheet, syncWorkspaceSettingToggles } from "../workspace/sheet-controller.js";
import { setToolMessage } from "../toolbar/toolbar-render.js";
import { renderedBounds, isFittableObject, renderableBoundsOf } from "../workspace/viewport.js";
import { emitDatumEvent } from "../../api/events.js";

/*
 * File commands operate on the whole drawing, reusing
 * the existing serialisation and history systems.
 */
export const drawingFileNew =
    document.getElementById("drawingFileNew");

export const drawingFileOpen =
    document.getElementById("drawingFileOpen");

export const drawingFileSave =
    document.getElementById("drawingFileSave");

export function newDrawing() {
    const previous =
        enggDrawingState.snapshotDrawing(
            drawingState
        );

    drawingState.objects = [];

    /*
     * New is a new DOCUMENT, not a new sheet. The old document's
     * sheets are gone with it - keeping them would mean pressing New
     * silently copied every drawing the student had made into a fresh
     * untitled file, which is not what New means anywhere else.
     *
     * One blank sheet, with its own id, and it is active.
     */
    editorState.sheetCollection =
        enggSheets.createCollection();

    loadSheetIntoEditor(
        activeSheet()
    );

    enggDrawingState.clearSelection(
        drawingState
    );

    enggDrawingState.clearInteraction(
        drawingState
    );

    enggDrawingState.commitDrawingChange(
        drawingState,
        previous
    );

    refreshSheetTabs();

    notifyReferences();

    /*
     * A new drawing has never been saved, so it has no file yet. The
     * next Save therefore asks for a name rather than quietly
     * overwriting whatever the previous drawing was called.
     */
    documentFileName = null;

    refreshDocumentTitle();

    /*
     * A new document belongs to no file. Forgetting the handle is
     * what guarantees the first Save asks where the file should go
     * rather than quietly overwriting whatever was open before.
     */
    enggFileSave.forgetFileHandle();

    /*
     * A BLANK NEW DOCUMENT HAS NO UNSAVED CHANGES.
     *
     * New replaces the document with an empty one. There is nothing on it for
     * the user to have changed, so it is not dirty - and it must not be, or a
     * student who presses New and then immediately presses Open is asked about
     * unsaved work they never made. Marking it dirty also meant every fresh
     * session began "unsaved", so the very first Open always interrupted.
     *
     * The document still has no file, which is a separate fact from being
     * unsaved: the next Save asks for a name because there is no name yet, not
     * because there is something to lose.
     */
    markDocumentClean();

    setToolMessage(
        "New drawing"
    );

    renderProperties();
    renderCurrentDrawing();
}

/*
 * The name of the file this document was last saved to, or null if
 * it has never been.
 *
 * A browser cannot write to a path the user did not choose, so Save
 * always produces a download. Remembering the name is what lets a
 * second Save do the obvious thing - offer the same file again -
 * rather than silently inventing "drawing.enggdraw" again, and it is
 * also what the dirty indicator and the unsaved-changes prompt
 * compare against.
 */
let documentFileName = null;

/*
 * Whether the document has changed since it was last saved.
 *
 * Tracked as a flag rather than inferred, because the things that
 * count as "the user changed something" - a moved handle, an edited
 * magnitude, a reversed load - go through many code paths, and each
 * of them marking the flag is the only way to be sure none is
 * missed.
 */
let documentDirty = false;

/*
 * Whether the document is being LOADED right now.
 *
 * Loading a file reconstructs sheets, features and relationships through
 * exactly the same code paths a person's edits use - a collection is
 * replaced, a sheet is created, an object is pushed. Several of those paths
 * report "the document changed", because when a PERSON causes them that is
 * true. During a load it is not: the document is being MADE to match a file,
 * not edited.
 *
 * Without this flag the last thing a load did was often to mark the
 * document dirty, so a file that had just been opened was treated as having
 * unsaved changes - and the next Open or New then interrupted the user with
 * a prompt about work they had not done. The flag makes document restoration
 * distinguishable from a user edit, which is the distinction the dirty
 * state is supposed to represent.
 */
let documentLoading = false;

/*
 * Mark the document as having unsaved changes.
 *
 * Called from the one place every committed edit passes through, so
 * adding a feature, dragging a handle, typing a value, reversing a
 * load or editing a distribution point all count without each of
 * them having to remember.
 *
 * A recovery copy is scheduled at the same time. It is written after
 * a short pause rather than immediately, so a drag that mutates
 * geometry on every pointermove costs one write at the end of it
 * rather than one per frame.
 */
export function markDocumentDirty() {
    /*
     * A LOAD IS NOT AN EDIT.
     *
     * While a file is being reconstructed, the state-update code that
     * normally means "the user changed something" runs as a side effect of
     * building the document. Marking the document dirty here would mean an
     * opened file arrived already unsaved, which is precisely the false
     * prompt this state exists to prevent. A load clears the flag at the
     * end, so nothing is lost by ignoring these notifications.
     */
    if (documentLoading) {
        return;
    }

    documentDirty = true;

    /*
     * The active sheet is written back here, not only when the user
     * switches away from it.
     *
     * Every committed edit in the application arrives at this one
     * function, so this is the only place that can be certain the
     * sheet holding the features is current. Doing it at the switch
     * instead would mean the sheet, the recovery copy and the dirty
     * flag were three views of the drawing that only agreed
     * sometimes - and a browser reload between an edit and a switch
     * would recover a drawing missing its most recent change.
     */
    syncActiveSheet();

    enggRecovery.schedule(
        serializeDocumentBody(),
        documentFileName
    );

    /*
     * A figure is rendered from the sheet, so an edit to the sheet is
     * a reason for any figure of it to be looked at again. Told from
     * here rather than from each edit path, for the same reason the
     * dirty flag is.
     */
    notifyReferences();

    /*
     * The header's unsaved mark follows the flag it describes, from the one
     * place the flag is set - so the mark cannot be stale, and no edit path has
     * to remember to update it.
     */
    refreshDocumentTitle();

    emitDatumEvent("documentchange");
}

/*
 * Note that the document matches what is on disk.
 *
 * This also drops the recovery copy, because a saved document is
 * not lost work - leaving it behind would greet the user with a
 * "recovery" of something they already have.
 */
function markDocumentClean() {
    documentDirty = false;

    enggRecovery.discard();

    /* The unsaved mark goes with the flag. */
    refreshDocumentTitle();
}

function documentIsDirty() {
    return documentDirty;
}

/*
 * Exposed for tests and the recovery prompt: the document's unsaved state and
 * whether a load is currently in progress. These are read-only views of the
 * one flag the editor owns; nothing outside this module may set it.
 */
export function documentHasUnsavedChanges() {
    return documentIsDirty();
}

export function documentIsLoading() {
    return documentLoading;
}

/*
 * Put the current document's name and unsaved mark into the header.
 *
 * Exposed so the editor can call it once at start-up, when there is no edit and
 * no save to trigger it - otherwise the header would sit empty until the user
 * happened to do something.
 */
export function refreshDocumentHeader() {
    refreshDocumentTitle();
}

/*
 * Begin and end a document load.
 *
 * Between these two calls every state update is treated as reconstruction
 * rather than as a user edit, so nothing marks the document dirty. The pair
 * is deliberately narrow: only the code that puts a file into the editor
 * uses it, and it always closes with the document clean.
 */
function beginDocumentLoad() {
    documentLoading = true;
}

function endDocumentLoad() {
    documentLoading = false;

    markDocumentClean();
}

function documentFile() {
    return documentFileName;
}

/*
 * ========================================================
 * THE DOCUMENT'S NAME, WITHOUT ITS EXTENSION
 * ========================================================
 *
 * A file called `triangle.enggdraw` is shown as `triangle`.
 *
 * ONLY THE FINAL `.enggdraw` IS REMOVED - never another period, and never
 * anything else. `Statics.V2.Final.enggdraw` is `Statics.V2.Final`, because the
 * rest of the name is the user's and this rule has no business editing it.
 *
 * The EXTENSION IS STILL THERE on disk. This is a display rule: the file is
 * `triangle.enggdraw`, and only the way the application TALKS about it changes.
 * A window title, a menu, a recent file - they all name the drawing, and the
 * drawing is called "triangle".
 */
function displayNameFor(fileName) {
    const name = String(fileName || "").trim();

    if (!name) {
        return "Untitled";
    }

    const suffix = `.${enggDocumentFile.EXTENSION}`;

    return name.toLowerCase().endsWith(suffix.toLowerCase())
        ? name.slice(0, -suffix.length)
        : name;
}

/*
 * Keep the browser tab named DAETUM and show the document's name in the header.
 *
 * The header carries the UNSAVED MARK as its own element, hidden and shown
 * rather than added and removed, so the name does not shift sideways when the
 * mark appears - a filename that jumped every time the user typed would be
 * worse than no mark at all.
 */
function refreshDocumentTitle() {
    const shown = displayNameFor(documentFileName);
    document.title = "DAETUM";

    const base = document.getElementById("headerDocumentBaseName");
    const host = document.getElementById("headerDocumentName");
    const mark = document.getElementById("headerDocumentDirty");

    if (base) {
        if (document.activeElement !== base) base.textContent = shown;
        if (!base.dataset.renameReady) {
            base.dataset.renameReady = "true";
            base.contentEditable = "true";
            base.setAttribute("role", "textbox");
            base.setAttribute("aria-label", "Document title");
            base.setAttribute("spellcheck", "false");
            base.addEventListener("focus", () => {
                base.dataset.originalName = displayNameFor(documentFileName);
                const range = document.createRange();
                range.selectNodeContents(base);
                const selection = window.getSelection();
                selection.removeAllRanges();
                selection.addRange(range);
            });
            base.addEventListener("keydown", event => {
                event.stopPropagation();
                if (event.key === "Enter") {
                    event.preventDefault();
                    base.blur();
                } else if (event.key === "Escape") {
                    event.preventDefault();
                    base.textContent = base.dataset.originalName;
                    base.blur();
                }
            });
            base.addEventListener("blur", () => {
                const wanted = base.textContent.trim().replace(/[\r\n]+/g, " ");
                if (wanted && wanted !== displayNameFor(documentFileName)) {
                    documentFileName = enggDocumentFile.withExtension(wanted);
                    markDocumentDirty();
                }
                refreshDocumentTitle();
            });
        }
    }

    if (host) {
        /*
         * The tooltip carries the FULL name, extension included - the header
         * truncates a long name, and a truncated name with no way to read the
         * whole of it would be a small cruelty.
         */
        host.title = documentFileName
            ? `${displayNameFor(documentFileName)} (${documentFileName})`
            : "This drawing has not been saved yet";
    }

    if (mark) {
        mark.hidden = !documentDirty;
    }
}

/*
 * The serialised document body, exactly as the state model holds it.
 *
 * This is the whole document: units, calibration, camera, every
 * object's real type, geometry, style, parent and parameters. The
 * format module wraps it; nothing here decides what the file is
 * called or how it is versioned.
 */
export function serializeDocumentBody() {
    /*
     * The editor holds the ACTIVE sheet, so it is written back before
     * the document is read. Saving is therefore exactly as accurate as
     * switching: whatever the user can see is what goes to the file,
     * and the sheet they were last looking at is the one that was
     * still being edited when they pressed Save.
     */
    syncActiveSheet();

    const body = JSON.parse(
        enggDrawingState.serializeDrawing(
            drawingState
        )
    );

    return {
        ...body,
        sheets: enggSheets.serializeCollection(
            editorState.sheetCollection
        ).sheets,
        activeSheetId: editorState.sheetCollection.activeSheetId,

        /*
         * THE WRITTEN SOLUTION TRAVELS WITH THE DRAWINGS.
         *
         * A submission is BOTH halves - the diagrams and the write-up - so the
         * write-up's source is stored in the same file as the sheets that explain
         * it. It is an ADDITIVE key: the format module spreads the body through
         * unchanged, so a file carrying it is still a valid `.enggdraw`, and one
         * saved before this existed simply reads back an empty solution.
         *
         * The DRAFT in localStorage is a safety copy of unsaved typing; THIS is
         * the document - the version that belongs in the file the student keeps.
         */
        [enggSolutionState.SOLUTION_DOCUMENT_KEY]:
            enggSolutionState.getSource()
    };
}

/*
 * Hand the file to the browser as a download.
 *
 * The File System Access API is used when it is available, because
 * that is the only route that lets Save write back to the same file
 * the user already chose. Where it is not available the download
 * route is used, which always works and is what most browsers will
 * do.
 */
/*
 * HAND A BLOB TO THE BROWSER AS A DOWNLOAD.
 *
 * The one place a file leaves the application. Every format goes through it, so
 * the anchor is created, clicked and removed in exactly one way, and an object
 * URL is always revoked - a URL left alive holds its whole blob in memory for
 * the lifetime of the page.
 */
function downloadBlob(blob, fileName) {
    const url =
        URL.createObjectURL(blob);

    const link =
        document.createElement("a");

    link.href = url;
    link.download = fileName;

    document.body.appendChild(link);
    link.click();
    link.remove();

    URL.revokeObjectURL(url);

    return fileName;
}

/*
 * The document's name WITHOUT a known extension, so a download can add whichever
 * one its format wants without ever doubling it ("Beam.pdf.enggdraw").
 */
function baseDocumentName() {
    const current = String(documentFileName || "drawing");

    const suffix = `.${enggDocumentFile.EXTENSION}`;

    return current.toLowerCase().endsWith(suffix.toLowerCase())
        ? current.slice(0, -suffix.length)
        : current;
}

/*
 * A filename for one of the export formats, built from the document's own name.
 *
 * `withExtension` is the SERIALIZER's own naming rule, reused rather than
 * reimplemented, so a downloaded name is formed the same way a saved one is.
 */
function exportFileName(extension) {
    const base = baseDocumentName();

    return base.toLowerCase().endsWith(`.${extension.toLowerCase()}`)
        ? base
        : `${base}.${extension}`;
}

function downloadDocumentFile(name) {
    const fileName =
        enggDocumentFile.withExtension(
            name || documentFileName || "drawing"
        );

    const payload =
        enggDocumentFile.createDocument(
            serializeDocumentBody()
        );

    const blob =
        new Blob(
            [JSON.stringify(payload, null, 2)],
            { type: enggDocumentFile.MEDIA_TYPE }
        );

    downloadBlob(blob, fileName);

    return fileName;
}

/*
 * ========================================================
 * DOWNLOAD: THE FOUR EXPORT FORMATS
 * ========================================================
 *
 * The File menu's Download submenu offers PDF, JPG, PNG and the native
 * `.enggdraw`. Each one is a REAL export of the document as it stands right now
 * - including unsaved changes - and none of them is a screenshot of the
 * application:
 *
 *   enggdraw  the editable document, through the same serializer Save uses
 *   png/jpg   the active sheet, through `renderSheetImageBlob` - the same
 *             image producer Save As already uses
 *   pdf       a print-ready page of the fitted drawing, handed to the
 *             browser's own PDF writer
 *
 * THE PDF ROUTE IS PRINT-TO-PDF, AND THAT IS A REAL PDF.
 *
 * This application bundles no PDF library and runs no server-side typesetter,
 * and adding one just to populate a menu item would rebuild the export system
 * for a format every browser already writes. So the drawing is composed into a
 * print-ready SVG page - VECTOR, not a raster grab - and the browser's own
 * Save-as-PDF is invoked on it, through the very mechanism the Print command
 * uses. The result is a genuine, scalable PDF of the drawing; it is not a
 * picture of the editor.
 */

/* The extension each format downloads with, and its media type. */
const DOWNLOAD_FORMATS = {
    enggdraw: {
        extension: enggDocumentFile.EXTENSION,
        type: enggDocumentFile.MEDIA_TYPE
    },
    pdf: { extension: "pdf", type: "application/pdf" },
    jpg: { extension: "jpg", type: "image/jpeg" },
    png: { extension: "png", type: "image/png" },
    latex: { extension: LATEX_EXTENSION, type: LATEX_MEDIA_TYPE }
};

/*
 * Compose the active sheet into a print-ready page, then hand it to the browser's
 * PDF writer. Returns the SVG it composed, or null when there was nothing to
 * draw - so the caller can say so rather than opening an empty print dialog.
 *
 * It is deliberately the SAME composition Print uses, down to the shared fit
 * engine (`fitBoundsIntoViewport`) and the shared clean renderer, so a PDF and a
 * print cannot frame the same drawing differently.
 *
 * Save As hands this to `file-save` as its `exportPdf` route, and the PDF
 * download calls it too, so there is one composition rather than two.
 */
function exportPdfPage() {
    const svg = composePrintablePage();

    if (!svg) {
        return null;
    }

    runPrintPass(svg);

    return exportFileName("pdf");
}

function composePrintablePage() {
    const fittableObjects =
        drawingState.objects.filter(isFittableObject);

    if (!fittableObjects.length) {
        return null;
    }

    const bounds = renderableBoundsOf(fittableObjects);

    const camera = enggDrawingExport.fitBoundsIntoViewport(
        bounds,
        enggDrawingExport.PRINT_PAGE_PX
    );

    if (!camera) {
        return null;
    }

    const padded = enggDrawingExport.paddedBounds(
        [
            { x: bounds.minX, y: bounds.minY },
            { x: bounds.maxX, y: bounds.maxY }
        ],
        enggDrawingExport.PRINT_PAGE_PX.width,
        enggDrawingExport.PRINT_PAGE_PX.height
    );

    if (!padded) {
        return null;
    }

    return enggDrawingExport.renderClean(drawingState, padded);
}

/*
 * Download the document in one of the four formats.
 *
 * Every branch is honest about failure: when there is nothing on the sheet, or
 * a render fails, the student is told so and the document is left untouched. No
 * branch writes a file it cannot vouch for.
 */
export async function downloadDrawing(format) {
    const chosen = DOWNLOAD_FORMATS[format];

    if (!chosen) {
        setToolMessage(`There is no ${format} export`);

        return null;
    }

    /*
     * THE NATIVE FORMAT IS THE DOCUMENT ITSELF, and it goes through the very
     * serializer Save uses - so a downloaded `.enggdraw` reopens with all of its
     * geometry, annotations, dimensions, ordering and sheet settings intact. It
     * is not an image of the drawing.
     */
    if (format === "enggdraw") {
        try {
            const name = downloadDocumentFile();

            setToolMessage(`Downloaded ${name}`);

            return name;
        } catch (error) {
            enggErrorLog.reportError("download enggdraw", error, {});

            setToolMessage("The document could not be downloaded");

            return null;
        }
    }

    /*
     * PDF: composed here, printed by the browser. The page is added to the
     * document for the print pass only, exactly as Print does, so the user stays
     * in the editor they were working in.
     */
    /*
     * LaTeX: every sheet as a drawing in standard LaTeX picture code, with the
     * document embedded so DAETUM can reopen it (file/latex/latex-document.js).
     */
    if (format === "latex") {
        try {
            const text = writeLatexDocument(serializeDocumentBody(), { title: baseDocumentName() });
            const name = downloadBlob(new Blob([text], { type: chosen.type }), exportFileName(chosen.extension));

            setToolMessage(`Downloaded ${name}`);

            return name;
        } catch (error) {
            enggErrorLog.reportError("download latex", error, {});

            setToolMessage("The LaTeX file could not be downloaded");

            return null;
        }
    }

    if (format === "pdf") {
        const name = exportPdfPage();

        if (!name) {
            setToolMessage(
                drawingState.objects.length
                    ? "Every feature on this sheet is hidden, so there is nothing to export"
                    : "There is nothing to export"
            );

            return null;
        }

        setToolMessage(
            "Choose Save as PDF in the print dialog to download the PDF"
        );

        return name;
    }

    /*
     * PNG and JPG: the same image producer Save As uses, so a downloaded image
     * and a saved one cannot differ in what they show.
     */
    try {
        const blob = await renderSheetImageBlob(format === "jpg" ? "jpg" : "png");

        if (!blob) {
            setToolMessage(
                drawingState.objects.length
                    ? `The ${format.toUpperCase()} could not be rendered`
                    : "There is nothing to export"
            );

            return null;
        }

        const name = downloadBlob(blob, exportFileName(chosen.extension));

        setToolMessage(`Downloaded ${name}`);

        return name;
    } catch (error) {
        enggErrorLog.reportError(`download ${format}`, error, {});

        setToolMessage(`The ${format.toUpperCase()} could not be downloaded`);

        return null;
    }
}

/*
 * Run an action, having first offered to save unsaved changes.
 *
 * Anything that replaces or abandons the current document - New, Open,
 * closing - has to ask before throwing work away. The three answers are the
 * conventional ones, and Cancel does nothing at all, which is the only safe
 * default: a user who is interrupted must never find their drawing replaced
 * because they pressed a key.
 *
 * The prompt is only shown when there is something to lose, so the ordinary
 * case of working in a new drawing - or of opening a file right after saving -
 * is never interrupted.
 *
 *   Save First        save the current drawing, then run the action. If the
 *                     save is cancelled or fails, the action does NOT run.
 *   Discard Changes   throw away the unsaved edits, then run the action. No
 *                     file is deleted: what is discarded is the in-memory
 *                     document's unsaved state, not anything on disk.
 *   Cancel            close the dialog and do nothing.
 *
 * Returns a promise resolving to whether the action ran. A caller that needs
 * to know - a test, or a second step that depends on it - can await it; the
 * menu can ignore it.
 */
function confirmDiscardUnsavedChanges(action) {
    if (!documentIsDirty()) {
        action();

        return Promise.resolve(true);
    }

    const file =
        documentFile() || "this drawing";

    /*
     * Asked with the application's own dialog rather than the browser's, for
     * the same reason the save panel is native: this is an interaction with
     * the person using the application, and it should look like the
     * application. It also means the three distinct answers can be laid out
     * as the three distinct choices they are.
     */
    return enggUi
        .choiceDialog(
            `${file} has unsaved changes.\n\n` +
            "Save before continuing?",
            {
                title: "Unsaved changes",

                buttons: [
                    {
                        id: "save",
                        label: "Save First",
                        primary: true
                    },
                    {
                        id: "discard",
                        label: "Discard Changes"
                    },
                    {
                        id: "cancel",
                        label: "Cancel",
                        dismiss: true
                    }
                ]
            }
        )
        .then(async (choice) => {
            if (choice === "cancel" || !choice) {
                return false;
            }

            if (choice === "save") {
                /*
                 * Saved before leaving, and only then does the action run.
                 * Cancelling the save panel therefore cancels the whole
                 * operation rather than abandoning the drawing: nothing is
                 * lost either way, and the student keeps what they were
                 * working on.
                 */
                const saved =
                    await saveDrawing();

                if (!saved) {
                    return false;
                }
            } else {
                /*
                 * DISCARD MEANS THE UNSAVED EDITS ARE GONE.
                 *
                 * The user has said the changes made since the last save are
                 * not wanted. The in-memory document is therefore marked clean
                 * BEFORE the action runs, so the decision is recorded once and
                 * is not asked about again - a destructive operation that is
                 * guarded must not raise the same prompt a second time.
                 *
                 * Only the in-memory dirty state is discarded. No file is
                 * deleted, and the saved .enggdraw on disk is untouched.
                 */
                markDocumentClean();
            }

            action();

            return true;
        });
}

/*
 * ========================================================
 * SAVING AS AN IMAGE
 * ========================================================
 *
 * There is no separate Export workflow. A student who wants a
 * PNG chooses Save As and picks the PNG type in the system panel;
 * the drawing is then rendered by the SAME renderer that draws the
 * canvas, and the bytes go straight into the file the panel named.
 *
 * That is why there is one image producer here and no export menu:
 * the format is decided once, by the Save As pipeline, and the
 * rendering is decided once, by this function.
 *
 * What the image contains is the DRAWING and only the drawing - the
 * renderer builds it from the model, not from a screenshot of the
 * editor, so no panel, cursor, snap marker, selection highlight or
 * half-finished preview can reach it. Selections are suppressed
 * because the export renders from a state whose selection is empty.
 */

/*
 * Every point the drawing is actually drawn through, across all of
 * its features.
 *
 * This is what an export is fitted to. It is the union of each
 * feature's RENDERED extent - force arrowheads, load arrows and
 * profiles, dimension text - rather than its stored geometry, so
 * nothing that is drawn can fall outside the image.
 */
/*
 * Every point an export of the CURRENT sheet is fitted to.
 *
 * Callable with a set of features and a zoom, so anything measuring a STORED or
 * non-active sheet - a thumbnail, a template card, a written-solution figure -
 * asks the same question through the same code. With no arguments it measures
 * the open sheet at the editor's own zoom, which is what Fit and Print want.
 */
function drawnBoundsPoints(objects, zoom) {
    return renderedPointsForObjects(
        objects || drawingState.objects,
        zoom
    );
}

/*
 * Every point a set of features is actually drawn through.
 *
 * The same measurement, for any set of features rather than only the
 * ones the editor has loaded. That is what lets a Drawing Reference
 * measure a sheet nobody is looking at: it asks for the rendered
 * extent of THAT sheet's features and gets the same answer an export
 * of it would give, because it is the same code doing the measuring.
 *
 * The zoom is the caller's to choose. The editor passes its own, so
 * the arrows of a load stand off its body by the size the user can
 * actually see. A reference passes nothing, because a reference
 * computes its own fit afterwards and wants the drawing's shape rather
 * than the size of whatever happens to be on screen.
 */
export function renderedPointsForObjects(objects, measuredAtZoom) {
    const points = [];

    /*
     * No camera is touched. The measurement scale is now a parameter
     * of renderedBounds, so a figure can be measured at zoom 1 for a
     * sheet the student happens to be looking at at 400% - without
     * borrowing, and having to put back, the editor's camera. That is
     * what makes the measurement independent rather than merely
     * self-restoring.
     */
    (objects || []).forEach((object) => {
        renderedBounds(
            object,
            measuredAtZoom
        ).forEach((point) => points.push(point));
    });

    return points;
}

/*
 * RENDER THE ACTIVE SHEET AS AN IMAGE, AS A BLOB.
 *
 * This is the one image producer in the application. Save As calls it
 * when the student picks PNG or JPG in the system panel; nothing else
 * renders an image, so a PNG and a JPG of the same drawing cannot
 * differ in what they show - only in how the finished pixels are
 * encoded.
 *
 * The drawing is rebuilt from the MODEL by the same renderer the canvas
 * uses, not captured from the screen. That is what guarantees the image
 * is a clean engineering snip: the renderer draws committed geometry and
 * the students' own content, and there is no code path by which a
 * toolbar, a Feature panel, a cursor, a snap label, a selection
 * highlight or an unfinished preview could be included.
 *
 * The bounds come from what is DRAWN - arrowheads, load profiles,
 * dimension text - rather than from stored geometry, so nothing that
 * reaches past its stored extent is cropped.
 *
 * Resolves to null when there is nothing to render, or the raster step
 * fails, so the caller reports an honest failure instead of writing an
 * empty file. Nothing about the document is touched either way.
 */
function renderSheetImageBlob(formatId) {
    return new Promise((resolve) => {
        if (!drawingState.objects.length) {
            resolve(null);
            return;
        }

        const jpg = formatId === "jpg";

        const image =
            enggDrawingExport.renderImage(
                drawingState,
                drawnBoundsPoints(),
                {
                    width: enggDrawingExport.DEFAULT_OUTPUT_PX,

                    /*
                     * JPG has no transparency, so it is laid down on
                     * white. PNG is left transparent outside the
                     * drawing, which is the more useful of the two for
                     * a line drawing.
                     */
                    background: jpg ? "#ffffff" : null
                }
            );

        if (!image) {
            resolve(null);
            return;
        }

        /*
         * The SVG the render produced is the source of the raster, so
         * the image is the same drawing rather than a second rendering
         * of it that might differ.
         */
        const dataUrl =
            new XMLSerializer()
                .serializeToString(image.svg);

        const encoded =
            `data:image/svg+xml;charset=utf-8,${encodeURIComponent(dataUrl)}`;

        const raster =
            new Image();

        raster.onload = () => {
            image.context.drawImage(
                raster,
                0,
                0,
                image.canvas.width,
                image.canvas.height
            );

            image.canvas.toBlob(
                (blob) => resolve(blob || null),
                jpg ? "image/jpeg" : "image/png",

                /*
                 * A quality that keeps dimension text and graph axes
                 * readable. High enough for engineering use, not so
                 * high that a large sheet becomes an enormous file.
                 */
                0.92
            );
        };

        raster.onerror = () => resolve(null);

        raster.src = encoded;
    });
}

/*
 * Print the drawing.
 *
 * Print and Fit are the same question about the same drawing: what is
 * on the sheet, and how big is it? So Print does not carry its own
 * answer. It asks the same bounds calculation Fit uses - the fittable
 * features of the active sheet, measured as DRAWN rather than as
 * stored - and fits them with the SAME shared fit engine
 * (`fitBoundsIntoViewport`) rather than a private one, so the two
 * can never disagree about what the drawing contains or how it is
 * framed. Whatever Fit would show, Print prints.
 *
 * The fitted drawing is then rendered clean by the shared export
 * pipeline - no panels, no cursor, no selection handles, no snap
 * markers, no unfinished preview - and handed to the browser's own
 * print dialog as an SVG page. SVG rather than a raster image is what
 * keeps the print independent of zoom, window size and device pixel
 * ratio: the page is described in its own coordinates and scaled by
 * the printer.
 *
 * Nothing about the editor is changed: the camera, selection,
 * interaction and undo history are exactly as they were afterwards.
 */
function printDrawing() {
    /*
     * The same features Fit Whole Page would act on: every visible
     * object on the ACTIVE SHEET. Hidden features are excluded by the
     * same predicate Fit uses, so a feature the student has turned off
     * does not silently reappear on paper - and a sheet whose features
     * are all hidden is answered as the empty sheet it effectively is,
     * rather than printing nothing or failing.
     */
    const fittableObjects =
        drawingState.objects.filter(
            isFittableObject
        );

    if (
        !fittableObjects.length
    ) {
        setToolMessage(
            drawingState.objects.length
                ? "Every feature on this sheet is hidden, so there is nothing to print"
                : "There is nothing to print"
        );

        return;
    }

    /*
     * THE BOUNDS FIT WOULD USE.
     *
     * `renderableBoundsOf` is the Fit module's own measurement of the
     * features' drawn extent, and `fitBoundsIntoViewport` is the shared
     * fit engine both Fit and the exports already go through. Print
     * asks them rather than measuring anything itself, so it cannot
     * crop what Fit shows, or include what Fit does not.
     */
    const bounds =
        renderableBoundsOf(fittableObjects);

    const camera =
        enggDrawingExport.fitBoundsIntoViewport(
            bounds,
            enggDrawingExport.PRINT_PAGE_PX
        );

    if (!camera) {
        setToolMessage(
            "Nothing to print on this sheet"
        );

        return;
    }

    /*
     * The padded world rectangle that corresponds to that fit, which
     * is what the clean renderer needs to lay out the page. The margin
     * ratio is the fit engine's own, so the whitespace printed is the
     * whitespace a Fit would leave - the drawing inset from the page
     * edge, not touching it and not lost in the middle.
     */
    const padded =
        enggDrawingExport.paddedBounds(
            [
                {
                    x: bounds.minX,
                    y: bounds.minY
                },
                {
                    x: bounds.maxX,
                    y: bounds.maxY
                }
            ],
            enggDrawingExport.PRINT_PAGE_PX.width,
            enggDrawingExport.PRINT_PAGE_PX.height
        );

    if (!padded) {
        return;
    }

    /*
     * The clean render sets the camera itself from the padded bounds
     * and restores the editor's camera afterwards, so no separate
     * camera bookkeeping is needed here.
     */
    const svg =
        enggDrawingExport.renderClean(
            drawingState,
            padded
        );

    /*
     * A null here means the render genuinely failed - reported as
     * such rather than showing an empty page and calling it printed.
     */
    if (!svg) {
        setToolMessage(
            "The drawing could not be prepared for printing"
        );

        return;
    }

    /*
     * PRINT IN PLACE, NOT IN A SECOND WINDOW.
     *
     * The rendered drawing is added to THIS document, and a print-only
     * stylesheet hides everything except it for the duration of the
     * print pass. The browser's print dialog therefore describes a page
     * containing the drawing alone, while the user stays in the editor
     * they were working in - no pop-up, no second window, and no popup
     * permission to ask for.
     *
     * The host carries the print rule inline rather than relying on the
     * app's CSS, so the behaviour does not depend on which stylesheets
     * happen to be loaded.
     */
    runPrintPass(svg);

    setToolMessage(
        "Prepared the fitted drawing for printing"
    );
}

/*
 * ========================================================
 * THE PRINT PASS: COMPOSE A PAGE, PRINT IT, TAKE IT AWAY
 * ========================================================
 *
 * Print and the PDF download are the same act - put the fitted drawing on a page
 * and hand that page to the browser - so they share this one function rather
 * than each carrying its own copy of the host, the stylesheet and the cleanup.
 * The only difference is what the student does with the dialog it opens: print,
 * or Save as PDF.
 *
 * THE PAGE IS A HIDDEN HOST PLUS A PRINT-ONLY STYLESHEET.
 *
 * The drawing is added to THIS document and the host is revealed only inside
 * `@media print`, so the print dialog describes a page containing the drawing
 * alone while the user stays in the editor they were working in - no pop-up, no
 * second window, and no popup permission to ask for.
 */
function runPrintPass(svg) {
    const PRINT_HOST_ID = "drawing-print-host";

    const previousHost =
        document.getElementById(PRINT_HOST_ID);

    if (previousHost) {
        previousHost.remove();
    }

    const host = document.createElement("div");

    host.id = PRINT_HOST_ID;
    host.setAttribute("aria-hidden", "true");

    /*
     * HIDDEN ON SCREEN, ALWAYS - NOT ONLY IN A PRINT STYLESHEET.
     *
     * This host holds a full-size fitted drawing. It used to be hidden by a
     * rule inside `@media print`, which meant that ON SCREEN it was a normal,
     * visible block laid over the application - and if the cleanup below ever
     * failed to run, a whole-page drawing stayed there, covering the editor and
     * swallowing every click. That is precisely the "a fitted diagram on the
     * whole page" defect.
     *
     * So it is hidden by an inline style, which is the strongest thing a page
     * can say about an element's own presentation and cannot be beaten by an
     * ordinary rule. The print stylesheet then REVEALS it, for the print pass
     * only, rather than being the only thing keeping it out of the way.
     */
    host.style.display = "none";

    host.appendChild(svg);

    document.body.appendChild(host);

    const style = document.createElement("style");

    style.id = "drawing-print-style";

    style.textContent = `
        @media print {
            body > *:not(#${PRINT_HOST_ID}) {
                display: none !important;
            }

            #${PRINT_HOST_ID} {
                display: block !important;
                margin: 0;
                padding: 0;
            }

            #${PRINT_HOST_ID} svg {
                width: 100%;
                height: auto;
            }

            @page {
                margin: 10mm;
            }
        }
    `;

    document.head.appendChild(style);

    /*
     * The print pass is transient. Whether the user prints or cancels,
     * the editor returns to exactly what it was.
     *
     * CLEANUP IS IDEMPOTENT AND OVERDETERMINED. The host is now hidden on
     * screen as well - see above - so a missed cleanup can no longer cover the
     * application; these listeners are the second line, and there is no harm in
     * any of them running after another.
     */
    let cleaned = false;

    const cleanup = () => {
        if (cleaned) {
            return;
        }

        cleaned = true;

        host.remove();
        style.remove();

        window.removeEventListener("focus", cleanup);
        document.removeEventListener("visibilitychange", onVisibility);
    };

    /*
     * `afterprint` is the event a browser is SUPPOSED to fire, and it is not
     * fired consistently - a dialog dismissed quickly, a print preview closed,
     * or a browser that simply does not implement it all leave the host behind.
     * So the same cleanup is also run when the page regains focus and when it
     * becomes visible again, both of which happen immediately after a print
     * dialog closes in every browser that has one.
     */
    function onVisibility() {
        if (!document.hidden) {
            cleanup();
        }
    }

    window.addEventListener("afterprint", cleanup, { once: true });
    window.addEventListener("focus", cleanup, { once: true });
    document.addEventListener("visibilitychange", onVisibility);

    /*
     * A safety timeout, now SHORT. It used to be a minute, which is a long time
     * for a hidden overlay to sit in the page; a print pass that has not
     * finished in five seconds is not going to.
     */
    setTimeout(cleanup, 5000);

    window.print();
}

/*
 * Save the drawing.
 *
 * Where the browser gave us a handle to a file, this writes straight
 * back to it: no panel, no name, and no way for the document to end up
 * in two places. Where it has not - a document that has never been
 * saved, or a browser without the handle API - the Save As flow runs
 * instead, because there is nothing to write back to.
 */
export async function saveDrawing() {
    const saved =
        await enggFileSave.save(
            serializeDocumentBody()
        );

    /*
     * A WRITE THAT FAILED IS NOT A SAVE.
     *
     * `file-save` reports a failed write as `{ error, detail }` rather than
     * throwing, so the distinction between "nothing to write back to" (null),
     * "written" (a name) and "the disk refused" (an error) is made here.
     *
     * The document is left DIRTY and its name unchanged, because neither is
     * true yet - and the user is told, in the one place they are looking, that
     * their work is still open. Claiming a save that did not happen is the
     * single most damaging thing this function could do.
     */
    if (saved && saved.error) {
        /*
         * A FAILED SAVE GOES THROUGH THE SAME REPORTER AS A FAILED OPEN.
         *
         * Both are "a file operation did not work", and both must reach the
         * user without blocking the page and without itself being able to
         * throw. `saved.detail` is the underlying error, which the report logs
         * for investigation.
         */
        reportFileProblem(saved.error, {
            operation: "save",
            detail: saved.detail
        });

        return false;
    }

    if (!saved) {
        /*
         * NOTHING TO WRITE BACK TO YET.
         *
         * This is reached in exactly one honest situation: a document that has
         * never been saved, so there is no file it could belong to. Save As is
         * then the only thing that can happen, and running it is right - the
         * user asked to keep their work and there is nowhere yet to keep it.
         *
         * It is NOT reached for a file that was opened: opening through the
         * handle picker gives the document a real save target, and where the
         * browser cannot provide one the file input path records the name so
         * Save has somewhere to go. A file that was opened therefore saves back
         * to itself, which is the whole point of the distinction.
         */
        return await saveDrawingAs();
    }

    documentFileName = saved;

    markDocumentClean();

    refreshDocumentTitle();

    setToolMessage(`Saved ${saved}`);

    return true;
}

/*
 * Save to a chosen name, location and format.
 *
 * The name, the folder and the FORMAT are the user's to choose, and the
 * panel that offers them is the operating system's own, so this behaves
 * the way saving from any other application does.
 *
 * The document's identity changes only once a DOCUMENT file has actually
 * been written. Saving a PNG does not make the document "be" a PNG, so
 * an image save leaves the document's name and handle exactly as they
 * were - cancelling the panel, or a disk that refuses, likewise leaves
 * the document as it was.
 *
 * SAVING IS NOT AN EDIT. Nothing here touches the undo history: the
 * document is written, not changed, so there is nothing to undo and no
 * entry is added.
 */
async function saveDrawingAs(options = {}) {
    const result =
        await enggFileSave.saveAs(
            serializeDocumentBody(),
            suggestedFileName(),
            {
                /*
                 * The image producer, handed in rather than reached for.
                 * file-save writes the bytes; this is what makes them,
                 * from the same renderer the canvas uses. It is called
                 * only when the chosen format is an image.
                 */
                renderImage: renderSheetImageBlob,

                /*
                 * THE PDF ROUTE, handed in for the same reason.
                 *
                 * There is no PDF writer in this application, so a Save As to
                 * PDF composes the fitted drawing into a print-ready page and
                 * lets the browser's own print-to-PDF produce the file - the
                 * same mechanism the Print command and the PDF download use, so
                 * all three cannot frame the drawing differently. It returns the
                 * suggested name, or null when there is nothing to export.
                 */
                exportPdf: exportPdfPage,

                /*
                 * A caller may name the format outright - the Download submenu
                 * and any direct Save As to PDF do. Otherwise it is read from
                 * the filename the system panel returns.
                 */
                format: options.format
            }
        );

    /* Cancelled. Nothing happened, so nothing is reported or changed. */
    if (!result) {
        return false;
    }

    if (result.error) {
        /*
         * A real failure - an empty drawing, or a render that could not
         * produce pixels. Reported honestly, and the document keeps its
         * old name and path so a retry goes to the same place.
         */
        setToolMessage(result.error);

        return false;
    }

    /*
     * ONLY A DOCUMENT SAVE ADOPTS THE NAME.
     *
     * An image is a copy of the drawing, not the document itself, so
     * the document keeps its own file name and stays marked clean -
     * saving a picture is a completed action, not an unsaved edit.
     */
    if (result.pdf) {
        /*
         * A PDF IS AN EXPORT, NOT THE DOCUMENT.
         *
         * The file the student chose is a PDF they will hand in; the editable
         * document keeps its own name, its own handle and its DIRTY state,
         * because nothing about their work has been saved yet. Marking it clean
         * here would be the single most damaging thing this could do - the next
         * Open or New would then discard unsaved edits without asking.
         */
        setToolMessage(
            "Choose Save as PDF in the print dialog to write the PDF"
        );

        return true;
    }

    if (!result.image) {
        documentFileName = result.name;

        markDocumentClean();

        refreshDocumentTitle();

        /*
         * A SAVED FILE IS A RECENT FILE.
         *
         * Save As writes the document to a new name, so that name should be
         * selectable from the Open launcher next time. The stored copy is the
         * document body exactly as it was written, which is what makes the
         * entry reopenable in every browser - the same reference Save, Save As,
         * Import and Recent all share.
         */
        enggRecentFiles.remember({
            name: result.name,
            handle: enggFileSave.currentFileHandle(),
            document: serializeDocumentBody(),
            preview: renderDocumentPreview(serializeDocumentBody())
        });

        setToolMessage(`Saved ${result.name}`);

        return true;
    }

    setToolMessage(`Saved ${result.name}`);

    return true;
}

/*
 * The name offered by the save panel.
 *
 * The current file's own name when the document has one, so that Save
 * As starts where the document already lives rather than at a generic
 * default. Saving a correction should suggest the file being
 * corrected, not "drawing".
 */
function suggestedFileName() {
    return enggDocumentFile.withExtension(
        documentFileName || "drawing"
    );
}

/*
 * Open a .enggdraw file.
 *
 * Reading is separated from applying on purpose. The format module
 * decides whether a file can be opened and, if so, what it should
 * become; only once it has answered both does anything here touch
 * the live document. That is what makes a bad file harmless: a
 * file that is not a drawing, or is from a newer build, or is
 * corrupt, is refused BEFORE the open document has been touched, so
 * the drawing the user already has is still there afterwards.
 *
 * Loading then goes through the same state model as a drawing built
 * in this session, so every feature comes back as its real type with
 * its real parameters, and the Feature Tree, Features panel, snapping
 * and manipulation all work on it without any special handling.
 */
/*
 * ========================================================
 * REPORTING A FILE PROBLEM
 * ========================================================
 *
 * Every failure a file can produce goes through here: it cannot be read, it is
 * empty, it is not a drawing, it is from a newer build, it is too old, or it
 * has no features. One function, so the same problem always reads the same way
 * and no path can accidentally report nothing.
 *
 * WHY THIS IS NOT `window.alert` ANY MORE.
 *
 * An alert was used before, and it is the wrong tool three times over. It
 * BLOCKS the page, so a file problem froze the workspace until dismissed. Its
 * wording cannot be styled, so a DAETUM message arrived looking like a browser
 * warning. And it can THROW - in a sandboxed iframe, or in any context where
 * dialogs are suppressed - which turns a handled error into an UNCAUGHT one,
 * so the failure being reported is replaced by a worse failure from the
 * reporting itself.
 *
 * So the message goes to the status line, which is always available and never
 * interrupts, and the error log records it with the file's name so a repeated
 * problem can be investigated. Nothing here can throw.
 */
function reportFileProblem(message, context = {}) {
    const detail =
        String(message || "") ||
        "That file could not be opened.";

    try {
        setToolMessage(detail);
    } catch (error) {
        /* A missing status line must not stop the report. */
    }

    enggErrorLog.reportError("open file", new Error(detail), context);

    return false;
}

/*
 * Read a file's size safely, for a message that can say what happened.
 */
function sizeOfFile(file) {
    const size = Number(file?.size);

    return Number.isFinite(size) ? size : null;
}

export function loadDrawing(
    payload,
    fileName
) {
    const result =
        enggDocumentFile.readDocument(
            payload
        );

    if (!result.ok) {
        /*
         * The reason is shown rather than a generic failure, because the user's
         * next action depends entirely on which of these it is: a wrong file
         * needs choosing again, an old one needs a different tool, and a future
         * one needs a newer DAETUM.
         */
        return reportFileProblem(result.detail, {
            fileName,
            failure: result.failure
        });
    }

    const data = result.document;

    if (
        !Array.isArray(data.objects) &&
        !Array.isArray(data.sheets)
    ) {
        return reportFileProblem(
            "That file is an EnggDraw drawing but contains no pages of " +
                "geometry. Your current drawing has not been changed.",
            { fileName, failure: "no-document-body" }
        );
    }

    /*
     * THE WRITTEN SOLUTION COMES BACK WITH THE DRAWINGS.
     *
     * It is restored BEFORE the sheets, so the figure references the source
     * carries can be resolved against the collection that is about to be
     * installed - and so the workspace's first render already has both halves of
     * the document. A file saved before the solution existed has no such key, and
     * is answered with an empty source rather than an error: an old drawing is
     * still a perfectly good drawing.
     */
    restoreSolutionSource(data[enggSolutionState.SOLUTION_DOCUMENT_KEY]);

    const previous =
        enggDrawingState.snapshotDrawing(
            drawingState
        );

    /*
     * FROM HERE UNTIL THE END OF THIS FUNCTION THE DOCUMENT IS BEING
     * RESTORED, NOT EDITED.
     *
     * Replacing the collection, loading a sheet, rebuilding features and
     * resolving relationships all reach code that, when the user causes it,
     * means "the document changed". During a load none of it is an edit, so
     * every such notification is ignored and the document is left clean at
     * the end. This is what stops an opened file from being treated as having
     * unsaved changes the moment it arrives.
     */
    /*
     * Apply the validated document. The reconstruction is wrapped so the
     * "loading" state is always closed, however it ends.
     */
    try {
        applyLoadedDocument(data, fileName, previous, result);
    } finally {
        /*
         * THE LOAD ALWAYS ENDS, EVEN IF IT THREW.
         *
         * An exception during reconstruction must not leave the editor in the
         * loading state, where every later edit would be silently ignored and
         * the document could never be saved. The flag is closed and the
         * document marked clean here, so a failed load is still a defined
         * state.
         */
        endDocumentLoad();
    }

    return data;
}

/*
 * Put the written solution's source back into the workspace.
 *
 * The workspace is loaded LAZILY - it may not have been opened yet, and it may
 * not be installed at all in a page without the solution tab - so this first
 * offers the source to the workspace, and always keeps the state's own copy in
 * step. That way a document opened while the Drawing tab is showing still brings
 * its write-up back when the student switches to it.
 */
function restoreSolutionSource(source) {
    const text = typeof source === "string" ? source : "";

    enggSolutionState.setSource(text);

    /*
     * The editor is updated only if it is on the page. The source is written to
     * the field AND through the workspace's loader where that exists, so the
     * outline and line numbers are rebuilt rather than left describing the
     * previous document.
     */
    const editor = document.getElementById("solutionEditor");

    if (editor) {
        editor.value = text;
    }

    if (typeof loadSolutionSource === "function") {
        loadSolutionSource(text);
    }
}

/*
 * Put a validated document into the editor: its settings, its sheets, its
 * features and its relationships, then render it.
 *
 * Called with the document already validated, and always between
 * beginDocumentLoad and endDocumentLoad - which is what makes the whole of
 * this reconstruction, rather than a set of user edits, and is why none of it
 * marks the document dirty at the end.
 */
function applyLoadedDocument(data, fileName, previous, result) {
    /*
     * The document's own settings, not just its features. Units and
     * calibration travel with the drawing because a length in a file
     * means nothing without them.
     *
     * Applied to the state, not to the collection: these are settings
     * of the whole document - the unit every length on every sheet is
     * in - rather than of any one drawing.
     */
    beginDocumentLoad();

    enggDrawingState.restoreDocument(
        drawingState,
        data
    );

    /*
     * The sheets. This REPLACES the collection rather than merging
     * into it, because opening a file is opening a document: whatever
     * was open before is not part of this one. The format module has
     * already repaired the list - a file always arrives with at least
     * one sheet and with unique ids - so what is loaded here can be
     * trusted without further checking.
     */
    editorState.sheetCollection =
        enggSheets.createCollection({
            sheets: data.sheets,
            activeSheetId: data.activeSheetId
        });

    /*
     * The sheet the user was last on goes into the editor, and it is
     * that sheet - not the document - that decides what the editor
     * shows: its features, its camera, its grid, its snapping.
     *
     * Reopening a file therefore puts the student back exactly where
     * they were, at the zoom they were working at, with the grid in
     * the state they had set on that particular sheet.
     */
    loadSheetIntoEditor(activeSheet());

    /*
     * MAKE THE ANALYSIS OBJECTS TRUE AGAIN, RATHER THAN TRUSTING
     * WHAT WAS SAVED.
     *
     * The dependencies are saved - which source each object reads
     * from - but the geometry derived FROM them is not, and must not
     * be: a saved components arrow is a snapshot of what a force
     * looked like once, and reloading it blindly would show a drawing
     * whose analysis objects quietly describe forces that have since
     * been edited. So the associations are restored from the file and
     * the values are recomputed from the sources as they are now.
     *
     * This is the difference between an analysis object being a
     * reading and being a copy, and it is why opening a file cannot
     * produce a diagram that disagrees with the beam above it.
     */
    enggDrawingState.refreshAnalysisObjects(
        drawingState
    );

    syncWorkspaceSettingToggles();

    enggDrawingState.commitDrawingChange(
        drawingState,
        previous
    );

    /*
     * An opened document is clean: it matches the file it came from. A
     * migrated file is also clean, because what was written and what is now
     * open describe the same drawing.
     */
    if (fileName) {
        documentFileName =
            enggDocumentFile.withExtension(
                fileName
            );
    }

    refreshDocumentTitle();

    refreshSheetTabs();

    notifyReferences();

    setToolMessage(
        result.migratedFrom &&
        result.migratedFrom !==
            enggDocumentFile.CURRENT_VERSION
            ? `Opened ${documentFileName || "drawing"} (upgraded from version ${result.migratedFrom})`
            : `Opened ${documentFileName || "drawing"}`
    );

    renderProperties();
    renderCurrentDrawing();
}

/*
 * Choose a .enggdraw file from the laptop and open it.
 *
 * This is IMPORT: the one action in the Open launcher that uses the operating
 * system's file panel. The file is read and validated before anything is
 * applied, so a file that cannot be opened leaves the current drawing
 * untouched - see loadDrawing, which is where that guarantee is made.
 *
 * Cancelling the panel is not an event the page is told about, so the returned
 * promise resolves either when the file has been handled or when the panel was
 * dismissed without one; either way the current document is unchanged until a
 * file actually arrives and loads.
 */
export function importDrawingFile() {
    /*
     * WHERE THE BROWSER CAN, OPEN THROUGH THE HANDLE PICKER.
     *
     * `showOpenFilePicker` is the only route that gives DAETUM a handle it can
     * later WRITE BACK to, which is what makes Save update the file the user
     * opened instead of asking for a name again. Where it exists it is used
     * first; where it does not, the ordinary file input is the fallback and
     * Save behaves as it always has.
     */
    if (enggFileSave.supportsOpenPicker()) {
        return enggFileSave
            .openWithPicker()
            .then(async (chosen) => {
                if (!chosen) {
                    /* Cancelled. Nothing happened, so nothing is reported. */
                    return false;
                }

                /*
                 * The handle is remembered BEFORE the file is read, so the
                 * document has its save target from the moment it is open -
                 * even if the read then fails, the target is the file the user
                 * actually chose.
                 */
                enggFileSave.setFileHandle(chosen.handle);

                return await openChosenFile(chosen.file);
            })
            .catch((error) => {
                /*
                 * A refused picker - a permission the browser withheld, or an
                 * unsupported call despite the API being present - is reported
                 * as the failure it is rather than silently falling back, which
                 * would leave the user wondering why nothing opened.
                 */
                if (error && error.name === "AbortError") {
                    return false;
                }

                return reportFileProblem(
                    "The file chooser could not be opened. Your current drawing " +
                        "has not been changed.",
                    { failure: error?.name || "open-picker" }
                );
            });
    }

    return new Promise((resolve) => {
        const input =
            document.createElement("input");

        input.type = "file";
        input.accept = `.${enggDocumentFile.EXTENSION},${enggDocumentFile.MEDIA_TYPE},application/json,.${LATEX_EXTENSION},${LATEX_MEDIA_TYPE},text/x-tex`;

        /*
         * Cancelling raises `cancel` in every browser that fires it, and no
         * event at all in the others. Both are handled: nothing is applied, and
         * the launcher the user came from has already closed, so cancelling
         * simply returns them to the drawing they had.
         */
        input.addEventListener("cancel", () => resolve(false));

        input.addEventListener("change", () => {
            const file =
                input.files && input.files[0];

            if (!file) {
                resolve(false);

                return;
            }

            openChosenFile(file).then(resolve);

            input.value = "";
        });

        input.click();
    });
}

/*
 * Read one chosen File and open it.
 *
 * Resolves true only when a drawing was installed. The file is read as text
 * and handed to applyOpenedText, which is the ONE place a file's contents
 * become a document - importing, opening a recent and recovering all reach it
 * rather than each growing a copy of the parse.
 */
function openChosenFile(file) {
    return new Promise((resolve) => {
        /*
         * A FILE THAT CANNOT BE READ AT ALL, REPORTED BEFORE READING.
         *
         * An empty file is the case a reader handles least clearly: the load
         * fires with "", the parse then fails, and the student is told the file
         * is "damaged" - when in fact it is empty, which is a different problem
         * with a different answer. A zero-length file is therefore caught here,
         * by size, before anything tries to parse it.
         */
        const size = sizeOfFile(file);

        if (size === 0) {
            resolve(
                reportFileProblem(
                    `"${file.name}" is empty, so there is nothing to open.`,
                    { fileName: file.name, failure: "empty-file" }
                )
            );

            return;
        }

        const reader = new FileReader();

        reader.addEventListener("load", () => {
            resolve(applyOpenedText(String(reader.result), file.name, file));
        });

        reader.addEventListener("error", () => {
            resolve(
                reportFileProblem(
                    `"${file.name}" could not be read. It may have been moved, ` +
                        "or DAETUM may not have permission to read it.",
                    { fileName: file.name, failure: reader.error?.name || "read" }
                )
            );
        });

        try {
            reader.readAsText(file);
        } catch (error) {
            /*
             * `readAsText` throws on a directory rather than firing `error`, so
             * the call itself is guarded too - otherwise choosing a folder from
             * the panel would be an uncaught exception rather than a message.
             */
            resolve(
                reportFileProblem(
                    `"${file.name}" could not be read. Choose an EnggDraw ` +
                        "drawing file.",
                    { fileName: file.name, failure: "unreadable" }
                )
            );

            enggErrorLog.reportError("read file", error, {
                fileName: file.name
            });
        }
    });
}

/*
 * Parse one file's text and apply it.
 *
 * Returns true only when a drawing was actually installed. A file that cannot
 * be parsed is reported and changes nothing, so a damaged file leaves the
 * drawing the user already has exactly as it was.
 *
 * `file` is optional: it carries the size and last-modified time that identify
 * the file in the recents list. Recovery passes text without one, and the
 * entry is keyed on the name alone in that case.
 */
/*
 * ================================================================
 * OPENING A .tex
 * ================================================================
 *
 * A .tex DAETUM wrote carries the whole document in a comment block
 * (file/latex/latex-document.js), so it opens exactly as the .enggdraw it
 * came from: every feature editable, every sheet and setting restored.
 *
 * IT NEVER BECOMES THE SAVE TARGET. Save writes .enggdraw JSON, and writing
 * that over the student's .tex would destroy the LaTeX they chose to open. So
 * the file handle is forgotten and the document takes the .tex's name with
 * the drawing extension: Save then writes "beam.enggdraw" beside "beam.tex".
 */
function isLatexFile(name, text) {
    return /\.tex$/i.test(String(name || "")) || hasEmbeddedDocument(text);
}

function applyOpenedLatex(text, name, file) {
    const base = String(name || "drawing").replace(/\.tex$/i, "") || "drawing";
    const embedded = readEmbeddedEnvelope(text);

    if (embedded.found && !embedded.ok) {
        return reportFileProblem(`${embedded.detail} Your current drawing has not been changed.`, {
            fileName: name,
            failure: embedded.failure
        });
    }

    if (!embedded.found) {
        return openLatexCode(text, base);
    }

    enggFileSave.setFileHandle(null);

    const opened = loadDrawing(embedded.envelope, base);

    if (opened) {
        enggRecentFiles.remember({
            name: enggDocumentFile.withExtension(base),
            file,
            handle: null,
            document: opened,
            preview: renderDocumentPreview(opened)
        });
    }

    return Boolean(opened);
}

/*
 * A .tex without DAETUM's data - LaTeX written by hand or by another program.
 * The LaTeX reader turns the drawing commands it understands into features.
 */
function openLatexCode(text, base) {
    openLatexCodeEditor({
        text,
        notice:
            `"${base}.tex" was not written by DAETUM, so it is shown here as code. ` +
            "The preview shows what DAETUM can draw from it; Insert into drawing adds it to the current sheet."
    });

    setToolMessage(`Opened ${base}.tex in the LaTeX code editor`);

    return true;
}

function applyOpenedText(text, name, file) {
    if (isLatexFile(name, text)) {
        return applyOpenedLatex(text, name, file);
    }

    let parsed;

    try {
        parsed = JSON.parse(text);
    } catch (error) {
        return reportFileProblem(
            `"${name || "That file"}" is not an EnggDraw drawing. It may be ` +
                "a different kind of file, or it may have been damaged. " +
                "Your current drawing has not been changed.",
            { fileName: name, failure: "not-json" }
        );
    }

    const opened = loadDrawing(parsed, name);

    /*
     * ONLY A FILE THAT ACTUALLY OPENED IS REMEMBERED.
     *
     * A recents entry is a promise that the drawing can be opened again, so a
     * file that failed to load is not added: an entry that cannot be opened is
     * worse than no entry at all. `loadDrawing` returns the reconstructed
     * document on success and false on failure, so the document stored with
     * the entry is exactly what is now open.
     *
     * THE FILE HANDLE GOES WITH IT, where there is one, so the entry can be
     * written back to - which is what lets Save update the file that was opened
     * rather than producing another copy of it.
     */
    if (opened) {
        enggRecentFiles.remember({
            name,
            file,
            handle: enggFileSave.currentFileHandle(),
            document: opened,

            /*
             * A PICTURE OF THE DRAWING, taken from the document that was just
             * loaded. It is made by the same renderer the canvas uses and
             * changes nothing about the document, so a recents list can show
             * what a file looks like without opening it.
             */
            preview: renderDocumentPreview(opened)
        });
    }

    return Boolean(opened);
}

/*
 * Open the drawing behind a recent entry.
 *
 * Preferred order:
 *
 *   1. A stored file handle. Where the browser gave one - File System Access
 *      on Chrome and Edge - the CURRENT file is read from disk, so the recent
 *      reflects the user's latest saved version rather than a stale copy.
 *   2. The stored document. Without a handle there is no way to reopen a file
 *      by path, so the copy kept with the entry is opened through the same
 *      loader. This is what makes Recents work in every browser.
 *
 * A handle whose permission has been revoked, or whose file has been moved or
 * deleted, is reported and the entry is marked missing - the list stays usable
 * and the other files still open.
 */
async function openRecentFile(entry) {
    const handle = enggRecentFiles.handleFor(entry.key);

    if (handle) {
        try {
            const file = await handle.getFile();

            const opened = await openChosenFile(file);

            if (opened) {
                return true;
            }
        } catch (error) {
            /*
             * The file is gone, or access was refused. This is the normal case
             * for a recently used file on a drive that is no longer attached,
             * so it is reported rather than thrown - and the entry is MARKED
             * missing rather than deleted, so the row stays in the list with a
             * working menu and can be removed, or reopened after the file comes
             * back.
             */
            enggRecentFiles.markMissing(entry.key);

            return reportFileProblem(
                `${entry.fileName} could not be found. It may have been moved, ` +
                    "renamed or deleted - or the drive it is on may not be " +
                    "connected. Import it again to reopen it.",
                { fileName: entry.fileName, failure: "missing-file" }
            );
        }
    }

    const document = enggRecentFiles.documentFor(entry.key);

    if (document) {
        /*
         * The stored copy goes through the ordinary loader, wrapped in the
         * ordinary envelope, so a recent is opened exactly as a file is -
         * validated, migrated and reconstructed the same way.
         */
        const opened = loadDrawing(
            enggDocumentFile.createDocument(document),
            entry.fileName
        );

        if (opened) {
            enggRecentFiles.remember({
                name: entry.fileName,
                document: opened
            });

            return true;
        }

        return false;
    }

    /*
     * Neither a handle nor a stored copy. The entry can still be listed, but
     * it cannot be reopened, so the user is told to import it rather than left
     * with a button that does nothing.
     */
    enggRecentFiles.markMissing(entry.key);

    setToolMessage(
        `${entry.fileName} has to be imported again to be reopened.`
    );

    return false;
}

/*
 * Start a new document from a template.
 *
 * A template is a document body, so it is loaded through the same loader a file
 * uses and is editable, saveable and reopenable from the moment it appears. It
 * has no file, so it is untitled and NOT dirty - there is nothing on it for the
 * user to have changed yet.
 */
function openTemplate(templateId) {
    const body = enggTemplates.copyDocumentFor(templateId);

    if (!body) {
        setToolMessage("That template is not available.");

        return false;
    }

    const template = enggTemplates
        .list()
        .find((entry) => entry.id === templateId);

    const loaded = loadDrawing(
        enggDocumentFile.createDocument(body),
        null
    );

    if (!loaded) {
        return false;
    }

    /*
     * A template is a NEW document, not a file. It belongs to no file, so a
     * later Save asks where to put it - and it is clean, because nothing on it
     * has been changed.
     */
    documentFileName = null;

    enggFileSave.forgetFileHandle();

    markDocumentClean();

    refreshDocumentTitle();

    setToolMessage(
        template ? `New drawing from ${template.name}` : "New drawing"
    );

    return true;
}

/*
 * Choose a .enggdraw and add it to the template library.
 *
 * The file is READ AND VALIDATED by the same loader an Open uses, so a template
 * can only ever be created from a document DAETUM could actually open - there is
 * no second parser, and a corrupt file is refused with the same reason an Open
 * would give.
 *
 * THE CURRENT DRAWING IS NOT TOUCHED, and is not guarded: adding a template is
 * not a document operation, so there is no unsaved-changes question and the
 * drawing stays exactly as it is.
 */
async function addTemplateFromFile() {
    const chosen = await readFileAsText();

    if (!chosen) {
        /* The panel was cancelled, or cancelled because there was no file. */
        return false;
    }

    let parsed;

    try {
        parsed = JSON.parse(chosen.text);
    } catch (error) {
        reportFileProblem(
            "That file could not be read. It may be damaged, or it may not " +
            "be an EnggDraw drawing."
        );

        return false;
    }

    /*
     * Validated the same way an Open validates, and against a THROWAWAY copy of
     * the reader so the current document is never involved. `readDocument`
     * neither throws nor mutates anything, which is what makes it safe to call
     * merely to ask "is this usable?".
     */
    const result = enggDocumentFile.readDocument(parsed);

    if (!result.ok) {
        reportFileProblem(result.detail);

        return false;
    }

    /*
     * The source file's name, offered as the default template name. The file
     * name travels with the text as an object, because a FileReader result is a
     * primitive string and cannot carry it.
     */
    const suggested =
        String(chosen.fileName || "")
            .replace(/\.enggdraw$/i, "")
            .trim() || "New Template";

    const name = await askForTemplateName(suggested);

    if (!name) {
        /* Cancelled at the name step. No template is created. */
        return false;
    }

    const preview = renderDocumentPreview(result.document);

    const id = enggTemplates.addTemplate({
        name,
        document: result.document,
        preview
    });

    if (!id) {
        setToolMessage("That template could not be saved.");

        return false;
    }

    setToolMessage(`Added ${name} to templates`);

    return true;
}

/*
 * Ask the user for a template's name.
 *
 * The source file's name is offered as the starting point, because it is very
 * often what the user would type anyway - but it is only a default, and the
 * name they give is what is stored. Returns null when cancelled, which the
 * caller treats as "no template was made" rather than as an error.
 */
function askForTemplateName(suggested) {
    return enggUi
        .promptDialog(
            "Give this template a name. It is only a label; the drawing it " +
            "was made from is not changed.",
            {
                title: "Add Template",
                fields: [
                    {
                        name: "name",
                        label: "Template Name",
                        value: suggested,
                        placeholder: "Statics Setup",
                        maxLength: 80
                    }
                ],
                confirm: "Add Template",
                cancel: "Cancel",
                onConfirm: (entered) =>
                    (entered.name || "").trim() ? entered : false
            }
        )
        .then((entered) =>
            entered ? String(entered.name).trim() : null
        );
}

/*
 * Rename a stored template.
 *
 * The display name only. The template's document and id are untouched, and the
 * `.enggdraw` it was made from is not referenced at all.
 */
async function renameTemplate(id) {
    const existing = enggTemplates
        .list()
        .find((entry) => entry.id === id);

    if (!existing) {
        return false;
    }

    const name = await askForTemplateName(existing.name);

    if (!name) {
        return false;
    }

    enggTemplates.renameTemplate(id, name);

    setToolMessage(`Renamed to ${name}`);

    return true;
}

/*
 * Read a chosen .enggdraw as text.
 *
 * Returns null when the panel was dismissed, which is the ordinary way to
 * change your mind and is not an error. The reader is the one place a file's
 * TEXT comes from, so every route into the application - import, open, recent,
 * template - shares it.
 */
function readFileAsText() {
    return new Promise((resolve) => {
        const input = document.createElement("input");

        input.type = "file";

        /*
         * THE NATIVE TYPE, NAMED AS THE FORMAT. The software is DAETUM; the
         * drawing format is EnggDraw, and `.enggdraw` is its extension.
         */
        input.accept = `.${enggDocumentFile.EXTENSION},${enggDocumentFile.MEDIA_TYPE},application/json`;

        input.addEventListener("cancel", () => resolve(null));

        input.addEventListener("change", () => {
            const file = input.files && input.files[0];

            if (!file) {
                resolve(null);

                return;
            }

            const reader = new FileReader();

            reader.addEventListener("load", () => {
                /*
                 * THE NAME TRAVELS WITH THE TEXT.
                 *
                 * A FileReader result is a primitive string, and a property
                 * cannot be attached to one - in module (strict) code the
                 * assignment THROWS, which would leave this promise unresolved
                 * forever and the caller waiting for a file that never arrives.
                 * So the two are returned together, as an object.
                 */
                resolve({
                    text: String(reader.result),
                    fileName: file.name
                });
            });

            reader.addEventListener("error", () => resolve(null));

            reader.readAsText(file);

            input.value = "";
        });

        input.click();
    });
}

/*
 * A small SVG picture of a stored document.
 *
 * A THIN WRAPPER over the shared fitted render, which is where the drawing
 * bounds, the sheet's World Scale and the neutral camera are decided. Keeping
 * the decision there - and not here - is what makes a Recent thumbnail, a
 * template card and a written-solution figure the same picture of the same
 * drawing.
 *
 * READ-ONLY throughout: the render works from a state built out of the stored
 * document, so nothing about the open document - its zoom, its selection, its
 * dirty state, its undo history - is read or touched. A preview that could not
 * be produced is simply not shown.
 */
function renderDocumentPreview(document) {
    try {
        const image = enggDrawingExport.renderFittedDocument(document, {
            width: 160
        });

        if (!image || !image.svg) {
            return null;
        }

        return new XMLSerializer().serializeToString(image.svg);
    } catch (error) {
        enggErrorLog.reportError("render document preview", error, {});

        return null;
    }
}

/*
 * The Open launcher: Templates, Recent files, and Import.
 *
 * File -> Open shows this rather than the operating system's file panel. The
 * unsaved-changes question is asked FIRST, so that by the time the launcher
 * appears the user has already decided what happens to the drawing they are
 * leaving - and a choice inside the launcher cannot silently replace work.
 *
 * The launcher reports a choice; every choice is then carried out here, so the
 * popup itself contains no file handling and cannot become a second way into
 * the application.
 */
export async function openDrawing() {
    /*
     * THE LAUNCHER IS SHOWN FIRST, AND THE GUARD IS ASKED AFTERWARDS.
     *
     * The launcher is a list of ways to START, and two of its three sections -
     * browsing templates and adding one - do not replace the drawing at all.
     * Asking about unsaved changes before the user has even chosen would be a
     * prompt about nothing, and it would make "+ Add Template" (which only
     * copies a file into the library) look like it was about to discard work.
     *
     * So the question is put to each choice that would actually REPLACE the
     * document - opening a template, a recent, or an import - and to none of the
     * choices that would not.
     */
    const choice = await enggOpenPopup.openOpenPopup();

    if (!choice || choice.action === "cancel") {
        return false;
    }

    if (choice.action === "template") {
        return confirmDiscardUnsavedChanges(
            () => openTemplate(choice.id)
        );
    }

    if (choice.action === "recent") {
        return confirmDiscardUnsavedChanges(
            () => openRecentFile(choice.entry)
        );
    }

    if (choice.action === "import") {
        return confirmDiscardUnsavedChanges(
            () => importDrawingFile()
        );
    }

    if (choice.action === "add-template") {
        /*
         * ADDING A TEMPLATE DOES NOT REPLACE THE DRAWING.
         *
         * The user is copying a file into the template library, not opening
         * it - the current document stays exactly as it is. So there is
         * deliberately NO unsaved-changes guard here: asking about unsaved work
         * would suggest the drawing is about to be replaced, which it is not.
         */
        return addTemplateFromFile();
    }

    if (choice.action === "rename-template") {
        return renameTemplate(choice.id);
    }

    return false;
}

/*
 * The File menu's actions, in one place.
 *
 * The menu and the keyboard shortcuts both go through this table, so
 * a command cannot exist on the menu and behave differently from the
 * same key. It also means adding a file command is a single entry
 * rather than a button and a handler that have to be kept in step.
 */
/*
 * ========================================================
 * DOCUMENT MANAGEMENT: RENAME, SHARE, DETAILS, TRASH
 * ========================================================
 *
 * The commands that act on the DOCUMENT rather than the drawing. Each one reuses
 * the state this module already owns - the file name, the dirty flag, the
 * serializer - rather than keeping a second copy of any of it.
 */

/*
 * RENAME.
 *
 * The name is validated HERE, because the dialog cannot know the application's
 * naming rules. A name is required, the extension is added by the SAME helper
 * Save uses, and the document's contents are untouched: only the name changes,
 * and the title and dirty indicator are refreshed from the one place that owns
 * them.
 *
 * WHAT IT DOES NOT DO: it does not rename a file on disk. A browser page cannot
 * rename a saved file. Where a writable handle exists the next Save writes to
 * that handle, so the name and the file agree; where it does not, the new name
 * is the name the next Save offers. The dialog's wording says so.
 */
export async function renameDrawing() {
  const current = displayNameFor(documentFileName);

  const typed = await enggDocumentManagement.askForNewName(current);

  if (typed === null || typed === undefined) {
    /* Cancelled. Nothing is renamed, which is what Cancel means. */
    return false;
  }

  const wanted = String(typed).trim();

  /*
   * AN EMPTY NAME IS REFUSED, not turned into "Untitled". A rename the user did
   * not really give is worse than a rename that did not happen, so the document
   * keeps its old name and the current state is reported.
   */
  if (!wanted) {
    setToolMessage("A drawing needs a name");

    return false;
  }

  const fileName = enggDocumentFile.withExtension(wanted);

  /*
   * A RENAMED DOCUMENT IS UNSAVED WORK.
   *
   * The document no longer matches the file it came from under its old name, so
   * it is marked dirty - which is what makes the next Save write the new name
   * rather than leaving the student believing a rename reached the disk when it
   * did not.
   */
  documentFileName = fileName;

  markDocumentDirty();

  refreshDocumentTitle();

  setToolMessage(`Renamed to ${fileName}`);

  return true;
}

/*
 * SHARE.
 *
 * There is no link, no account and no permission system in this application, and
 * inventing a "share link" would be a lie the user would discover when it did not
 * work. What genuinely exists is a self-contained document, so Share offers the
 * two real ways to pass it on: copy it to the clipboard, or download it.
 */
export function shareDrawing() {
  return enggDocumentManagement.showShareDialog({
    fileName: documentFileName,

    /*
     * The two actions the dialog really offers, wired to the commands that
     * already exist for them: the clipboard copy above, and the NATIVE download
     * - the same `.enggdraw` a Save writes, so what someone is passed can be
     * reopened and edited rather than being a picture of it.
     */
    onCopy: () => copyDrawingToClipboard(),
    onDownload: () => downloadDrawing("enggdraw")
  });
}

/*
 * Copy the whole document to the system clipboard.
 *
 * The same JSON a `.enggdraw` file holds, so what is pasted is a complete
 * document that can be saved back as one - not a picture and not a summary.
 */
export async function copyDrawingToClipboard() {
  const payload = enggDocumentFile.createDocument(
    serializeDocumentBody()
  );

  const text = JSON.stringify(payload, null, 2);

  try {
    await navigator.clipboard.writeText(text);

    setToolMessage("Drawing copied to the clipboard");

    return true;
  } catch (error) {
    /*
     * A clipboard write can be refused - no permission, an insecure context, a
     * browser that requires a user gesture it did not see. Reported honestly
     * rather than claiming a copy that did not happen.
     */
    enggErrorLog.reportError("copy drawing", error, {});

    setToolMessage("The drawing could not be copied to the clipboard");

    return false;
  }
}

/*
 * DETAILS.
 *
 * Reads what is actually recorded, from the live state, so the panel reflects
 * the document that is open right now.
 */
export function showDrawingDetails() {
  return enggDocumentManagement.showDocumentDetails({
    fileName: documentFileName,
    dirty: documentIsDirty(),
    serialize: serializeDocumentBody
  });
}

/*
 * MOVE TO TRASH.
 *
 * A browser page cannot delete a file the user saved to their own disk, so this
 * does NOT claim to. It removes the document's copy from the application - the
 * recent-files entry the app would offer to reopen - and replaces the workspace
 * with a new, blank drawing, having asked first and having said plainly that a
 * file on disk is untouched.
 */
export async function moveDrawingToTrash() {
  const choice = await enggDocumentManagement.confirmMoveToTrash(
    displayNameFor(documentFileName)
  );

  if (choice !== "trash") {
    /* Cancel - including Escape and a backdrop click. Nothing happens. */
    return false;
  }

  /*
   * THE APPLICATION'S OWN COPY GOES.
   *
   * The recent entry is the document the application is holding and would offer
   * to reopen, so removing it is the part of "move to trash" this side can
   * really perform. A failure to remove it is reported rather than swallowed.
   */
  try {
    if (documentFileName) {
      enggRecentFiles.forget(documentFileName);
    }
  } catch (error) {
    enggErrorLog.reportError("move to trash", error, {});

    setToolMessage("The drawing could not be removed from DAETUM");

    return false;
  }

  /*
   * AND THE WORKSPACE RETURNS TO A CLEAN SHEET, through the SAME New path every
   * other new-document action uses - so the sheet collection, the camera, the
   * history sinks and the dirty flag are all reset in the one place that knows
   * how, rather than in a second version here.
   */
  newDrawing();

  setToolMessage("Moved to Trash. A saved file on your computer is unchanged.");

  return true;
}

export const FILE_ACTIONS = {
  new() {
    /*
     * Both the menu and the shortcut go through the unsaved-changes
     * guard, so New always offers to save first.
     */
    confirmDiscardUnsavedChanges(newDrawing);
  },
  open() {
    openDrawing();
  },
  save() {
    saveDrawing();
  },
  "save-as"(options) {
    saveDrawingAs(options);
  },
  print() {
    printDrawing();
  },

  /*
   * Download, in one of the four formats the File menu offers.
   *
   * It takes the format as an argument because the submenu names it; the work
   * itself is in `downloadDrawing`, which is also what a test drives directly.
   */
  download(format) {
    return downloadDrawing(format);
  },

  rename() {
    return renameDrawing();
  },
  share() {
    return shareDrawing();
  },
  details() {
    return showDrawingDetails();
  },
  "move-to-trash"() {
    return moveDrawingToTrash();
  }
};

/*
 * Offer the user a recovery copy, if there is one worth offering.
 *
 * Asked once, when the drawing workspace opens, and only when there
 * is genuinely something to rescue. Declining discards it, so a
 * user who does not want it is not asked again next time - and, just
 * as importantly, a stale copy of a drawing they have since finished
 * does not reappear as a warning weeks later.
 *
 * THE TWO CHOICES ARE NAMED FOR WHAT THEY DO.
 *
 * "Recover" and "Discard Recovery" are unambiguous, where a yes/no prompt
 * leaves the user guessing which button keeps the work. The application's own
 * dialog is used for the same reason the unsaved-changes prompt uses it: this
 * is a question about the user's own drawing, and it should look and behave
 * like the rest of DAETUM.
 *
 * RECOVERED WORK IS UNSAVED WORK.
 *
 * The recovery copy exists precisely because a save did not happen, so the
 * restored document is marked DIRTY. It is deliberately not treated as clean:
 * a document that claimed to be saved would make the next Open or New discard
 * the very work the recovery was for. The user can then Save or Save As
 * normally, which is the only correct way for it to become saved.
 */
export async function offerRecoveryIfAvailable() {
    const record =
        enggRecovery.describe();

    if (!record) {
        return false;
    }

    const features =
        record.features === 1
            ? "1 feature"
            : `${record.features} features`;

    const when =
        record.when
            ? `Last edited ${record.when}.`
            : "";

    const choice = await enggUi.choiceDialog(
        "DAETUM found unsaved work from a previous session " +
            `(${features}).\n\n${when}`.trim() +
            "\n\nRecover it?",
        {
            title: "Recovered drawing available",
            buttons: [
                { id: "recover", label: "Recover", primary: true },
                {
                    id: "discard",
                    label: "Discard Recovery",
                    dismiss: true
                }
            ]
        }
    );

    if (choice !== "recover") {
        /*
         * Declining removes the copy, so the same question is not asked on
         * every visit. Nothing is lost by this beyond the recovery copy itself,
         * which the user has just said they do not want.
         */
        enggRecovery.discard();

        return false;
    }

    /*
     * Recovery goes through the same loader as opening a file, so
     * what comes back is a real document rather than a special
     * half-restored state.
     */
    const stored = enggRecovery.read();

    if (!stored) {
        return false;
    }

    const loaded = loadDrawing(
        {
            /*
             * The stored copy is already a document body. It is
             * wrapped in the same envelope a file carries and read
             * back through the same loader, so a recovered drawing
             * is version-checked and migrated exactly as an opened
             * file would be - there is no second, less careful path
             * for recovered work.
             */
            format: "enggdraw",
            version: enggDocumentFile.CURRENT_VERSION,
            document: stored.document
        },
        stored.fileName || undefined
    );

    if (!loaded) {
        return false;
    }

    /*
     * The recovered document contains work that was never saved, so it is
     * dirty - and the recovery copy is discarded, because it has now been
     * delivered into the editor rather than left behind as a second copy that
     * would be offered again next time.
     */
    markDocumentDirty();

    enggRecovery.discard();

    setToolMessage(
        `Recovered ${documentFile() || "unsaved work"} from the previous session`
    );

    return true;
}

/*
 * Wire this part of the editor to the page. Called once, at start-up,
 * by editor/index.js.
 */
export function installDocumentCommands() {
    /*
     * Tell the state model that the controller owns the document's file
     * and dirty state, so it can report every committed edit.
     */
    enggDrawingState.setDocumentChangedHandler(
        markDocumentDirty
    );

    /*
     * Tell the export module what the editor draws.
     *
     * The editor is the only place that knows how far a force's
     * arrowhead reaches past its stored end, or how far a load's arrows
     * stand off its body, so it supplies that to the export. Registering
     * it once here means every export - PNG, JPG, SVG, Print - is fitted
     * to the same extent the editor draws, and none of them can crop a
     * feature the editor itself shows.
     */
    enggDrawingExport.setBoundsProvider(
        drawnBoundsPoints
    );

    /*
     * Teach the reference system where sheets are and how a feature is
     * measured.
     *
     * Registered here, beside the bounds provider above, because this is
     * the only place that holds both. The reference module itself knows
     * nothing about the document model - it is handed a way to find a
     * sheet and a way to measure it - which is what keeps it reusable and
     * keeps the written solution from having to understand drawings.
     */
    enggDrawingReference.configure({
        getSheet: sheetById,

        /*
         * Measured at zoom 1, explicitly.
         *
         * A figure is a statement about the DRAWING, not about the view,
         * so it must not change size when the student zooms in on a
         * detail in the editor. Saying so here rather than leaving it to
         * whatever the camera happens to be is what makes that true.
         */
        getRenderedPoints: (objects) =>
            renderedPointsForObjects(objects, 1)
    });

    installWorkProtection();
}

/*
 * ========================================================
 * PROTECTING WORK THAT HAS NOT BEEN SAVED
 * ========================================================
 *
 * The recovery copy already exists: a committed edit schedules a write.
 * Scheduling on every edit is not by itself enough, though, because it depends
 * on an edit happening to be the last thing before a failure. Two additions
 * close that gap:
 *
 *   1. A WARNING BEFORE LEAVING. A page reload or a closed tab with unsaved
 *      work should ask first. The browser's own prompt is the only mechanism a
 *      page has for this, so it is used - and it is a SECOND line of defence,
 *      not the first: the recovery copy below is what actually preserves the
 *      drawing, since a user can always dismiss a prompt.
 *
 *   2. A PERIODIC SNAPSHOT. A safety net for the failures a change listener
 *      cannot see: a tab that is about to be discarded, a long idle stretch, a
 *      crash that happens with no edit in flight. It is a timer rather than a
 *      write on every frame, so drawing stays smooth, and it writes only while
 *      there is something unsaved to protect.
 */
function installWorkProtection() {
    const UNSAVED_MESSAGE =
        "This drawing has unsaved changes. Save it before leaving?";

    /*
     * Ask before leaving with unsaved work.
     *
     * A page cannot show its own dialog here - the browser shows a generic
     * one and ignores any message text - so the wording is set for the
     * browsers that still show it, and no return value is relied on.
     */
    window.addEventListener("beforeunload", (event) => {
        if (!documentIsDirty()) {
            return undefined;
        }

        event.preventDefault();
        event.returnValue = UNSAVED_MESSAGE;

        return UNSAVED_MESSAGE;
    });

    /*
     * A snapshot on a timer, in addition to the one each edit schedules.
     *
     * Thirty seconds is short enough that very little work is ever at risk and
     * long enough that serialising a large drawing costs nothing noticeable.
     */
    window.setInterval(() => {
        if (!documentIsDirty() || documentLoading) {
            return;
        }

        try {
            enggRecovery.schedule(
                serializeDocumentBody(),
                documentFileName
            );
        } catch (error) {
            /*
             * A snapshot that fails must not interrupt the session. Reported,
             * because a recovery copy that is silently never written is exactly
             * the failure this is here to prevent, and the user would otherwise
             * only discover it after a crash.
             */
            if (typeof console !== "undefined" && console.warn) {
                console.warn(
                    "[DAETUM] A recovery snapshot could not be taken.",
                    error
                );
            }
        }
    }, RECOVERY_SNAPSHOT_MS);
}

/*
 * How often a recovery snapshot is taken while there is unsaved work.
 */
const RECOVERY_SNAPSHOT_MS = 30000;

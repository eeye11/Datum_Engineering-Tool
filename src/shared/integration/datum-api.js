/*
 * ============================================================
 * THE DAETUM INTEGRATION API
 * ============================================================
 *
 * This is the one supported way for other tools - the OCR pipeline, the
 * autograder, a course platform - to work with DAETUM. Everything else in
 * src/ is internal and may change without notice; this module is versioned
 * (API_VERSION) and documented in docs/INTEGRATION.md.
 *
 * WHAT DAETUM HOLDS
 * ----------------
 * A student's submission has two halves:
 *
 *   - the WRITTEN SOLUTION, a LaTeX source (typically produced by the OCR
 *     tool from the handwritten page and corrected by the student), and
 *   - the DRAWINGS, one per sheet of the DAETUM document.
 *
 * The written solution places a drawing with a reference token,
 * [DRAWING_REFERENCE:<sheetId>]. The token names a sheet, not a picture,
 * so the figure always shows the sheet's current contents.
 *
 * WHAT THE API OFFERS
 * -------------------
 *   getDocument()               the whole document, as a .enggdraw file object
 *   loadDocument(file)          replace the document with a .enggdraw file
 *   listSheets()                [{ id, name }] in document order
 *   renderSheetSvg(id, options) one sheet drawn as standalone SVG markup
 *   getSolution()               the LaTeX source and the references in it
 *   setSolution(latex)          replace the LaTeX source and re-render
 *   on(event, listener)         "documentchange" | "solutionchange"
 *
 * Every result is plain, JSON-safe data, so the same calls work in the
 * page (window.datum) and across an iframe (src/api/embed-bridge.js).
 */
import enggDocumentFile from "../file/document-file.js";
import enggDrawingReference from "../references/drawing-reference.js";
import { enggDrawingSheets } from "../../features/workspace/index.js";
import { loadDrawing } from "../../features/workspace/commands/document-commands.js";
import { render as renderSolution } from "../solution/written-references.js";
import { onDatumEvent } from "./events.js";

/*
 * The API's own version. It changes only when a call is removed or its
 * result changes shape; new calls do not change it.
 */
export const API_VERSION = 1;

/*
 * THE WRITTEN SOLUTION'S EDITOR.
 *
 * It used to be the `writingCode` textarea in the three-column panel. The
 * workspace redesign made it `solutionEditor`, and this is the ONE line that
 * changes for the public API - the callers of `getSolution` and `setSolution`
 * see exactly the same shape of result as before.
 */
function solutionSource() {
    return document.getElementById("solutionEditor");
}

/*
 * The workspace's own "load this source" path, if the workspace is installed.
 * Undefined in a page that has the API but not the solution tab, which is why
 * the call site checks for it.
 */
let setSolutionSource = null;

export function attachSolutionSourceLoader(loader) {
    setSolutionSource = typeof loader === "function" ? loader : null;
}

/* The whole document, exactly as Save would write it. */
function getDocument() {
    return JSON.parse(JSON.stringify(
        enggDocumentFile.createDocument(enggDrawingSheets.serializeDocumentBody())
    ));
}

/*
 * Replace the document with a .enggdraw file: the parsed object, or its
 * JSON text. Older file versions are migrated; a file that is not a DAETUM
 * document is refused and the current document is left as it was.
 */
function loadDocument(file) {
    let parsed = file;

    if (typeof file === "string") {
        try {
            parsed = JSON.parse(file);
        } catch {
            return { ok: false, failure: enggDocumentFile.Failure.NOT_JSON, detail: "The text is not JSON." };
        }
    }

    const checked = enggDocumentFile.readDocument(parsed);

    if (!checked.ok) {
        return { ok: false, failure: checked.failure, detail: checked.detail };
    }

    return loadDrawing(parsed) === false
        ? { ok: false, detail: "The document could not be loaded." }
        : { ok: true };
}

function listSheets() {
    return enggDrawingSheets.all().map(sheet => ({ id: sheet.id, name: sheet.name }));
}

/*
 * One sheet drawn as standalone SVG markup, fitted to its contents - the
 * same rendering the written solution and the image export use.
 *
 * options: { width, height, caption } (all optional)
 * result:  { ok: true, svg, width, height }
 *        | { ok: false, reason: "missing-sheet" | "unmeasured" | "empty" | ... }
 */
function renderSheetSvg(sheetId, options = {}) {
    const rendered = enggDrawingSheets.renderReference(sheetId, options);

    if (!rendered || !rendered.ok || !rendered.svg) {
        return { ok: false, reason: rendered?.reason || (rendered?.empty ? "empty" : "not-rendered"), sheetId };
    }

    return {
        ok: true,
        sheetId,
        // XMLSerializer writes a standalone SVG document, namespace included.
        svg: new XMLSerializer().serializeToString(rendered.svg),
        width: rendered.bounds?.width ?? null,
        height: rendered.bounds?.height ?? null
    };
}

/* The written solution's LaTeX source, and the drawings it references. */
function getSolution() {
    const latex = solutionSource()?.value || "";

    return {
        latex,
        references: enggDrawingReference.parseReferences(latex).map(reference => ({
            sheetId: reference.sheetId,
            sheetName: enggDrawingSheets.sheetById(reference.sheetId)?.name ?? null
        }))
    };
}

/* Replace the written solution's LaTeX source, and render it. */
function setSolution(latex) {
    const source = solutionSource();

    if (!source) {
        return { ok: false, detail: "The written solution is not on this page." };
    }

    source.value = String(latex ?? "");

    /*
     * THE WORKSPACE IS TOLD, SO ITS VIEWS FOLLOW.
     *
     * Writing `value` alone would leave the outline, the line numbers and the
     * saved draft showing the previous source. The workspace's own loader is
     * called instead of dispatching an `input` event, because `input` is what
     * means "the STUDENT changed something" - and loading a document through the
     * API is not the student typing. Raising the student's own event here would
     * report a change that the API call already reports, which is one too many.
     */
    if (typeof setSolutionSource === "function") {
        setSolutionSource(source.value);
    }

    renderSolution();

    return { ok: true };
}

/*
 * Subscribe to a change. Returns a function that unsubscribes.
 *
 *   "documentchange"   a drawing, sheet or document setting changed
 *   "solutionchange"   the LaTeX source was edited
 */
function on(event, listener) {
    return onDatumEvent(event, listener);
}

export function createDatumApi() {
    return Object.freeze({
        API_VERSION,
        documentVersion: enggDocumentFile.CURRENT_VERSION,
        getDocument,
        loadDocument,
        listSheets,
        renderSheetSvg,
        getSolution,
        setSolution,
        on
    });
}

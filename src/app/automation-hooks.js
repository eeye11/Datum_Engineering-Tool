/*
 * BROWSER-AUTOMATION HANDLES.
 *
 * Browser tests (tests/e2e) and developer scripts (tools/) drive the
 * running page and need to read its state: the document model, the sheets,
 * the export pipeline. Before the move to ES modules every module was a
 * window global, so they simply read window.enggDrawing and friends. These
 * handles keep exactly those names available for that tooling.
 *
 * This is not an integration API. Code that embeds DAETUM or exchanges
 * documents with it should use src/api/ instead, which is versioned and
 * documented; these names may change whenever the internals do.
 */
import enggDocumentFile from "../shared/file/document-file.js";
import enggDrawingExport from "../shared/file/document-export.js";
import enggRecovery from "../shared/file/document-recovery.js";
import enggRecentFiles from "../shared/file/recent-files.js";
import enggTemplates from "../shared/file/templates.js";
import enggErrorLog from "./error-log.js";
import enggFileSave from "../shared/file/file-save.js";
import enggAxisLabels from "../shared/geometry/axis-labels.js";
import enggDrawOrder from "../features/workspace/commands/draw-order.js";
import * as enggDimensionPlacement from "../features/workspace/annotate/dimension-placement.js";
import * as enggDimensionInference from "../features/workspace/annotate/dimension-inference.js";
import * as enggDimensionPreview from "../features/workspace/geometry/preview.js";
import * as enggHitTesting from "../features/workspace/interaction/hit-testing.js";
import enggLoadProfile from "../features/workspace/model/analysis/load-profile.js";
import { editorState } from "../features/workspace/editor-state.js";
import { drawingState } from "../features/workspace/editor-state.js";
import enggDrawingReference from "../shared/references/drawing-reference.js";
import enggDrawingRenderer from "../shared/rendering/renderer.js";
import enggDrawingState from "../shared/model/drawing-state.js";
import enggSheets from "../components/layout/workspace/sheets.js";
import enggOpenPopup from "../components/layout/toolbar/open-popup.js";
import enggUi from "../shared/ui/ui.js";
import enggWrittenReferences from "../shared/solution/written-references.js";

/*
 * ============================================================
 * IMPORTED FROM THEIR OWN MODULES, NOT THROUGH THE BARREL
 * ============================================================
 *
 * This used to read `from "../features/workspace/index.js"`, and that single
 * line closed a two-way cycle: the barrel installs the drawing panel and the
 * toolbar wiring, and this module is imported by the entry point which imports
 * the barrel. The cycle threw a temporal-dead-zone `ReferenceError` while the
 * graph was still linking, and a throw at THAT point is invisible: it happens
 * before `installGlobalErrorHandlers` exists, so nothing is logged, and it
 * aborts the tail of both the barrel and the entry module. The visible symptom
 * was an application that rendered perfectly while every `window.enggX` handle
 * and `window.datum` was silently missing.
 *
 * All three names are defined elsewhere and merely re-exported by the barrel,
 * so importing them directly is the same objects with the same behaviour and
 * one fewer edge in the graph. The barrel keeps its re-exports for every other
 * caller.
 */
import { enggDrawing, enggDrawingSheets } from "../components/layout/workspace/sheet-controller.js";
import * as enggTransforms from "../features/workspace/geometry/transforms.js";

export function installAutomationHooks(target = window) {
    /*
     * ============================================================
     * IDEMPOTENT, AND SAFE TO CALL FROM MORE THAN ONE PLACE
     * ============================================================
     *
     * These handles used to be installed from ONE statement near the end of the
     * entry module, and that statement did not run. The entry module imports the
     * workspace barrel, which installs the toolbar wiring, which imports the
     * toolbar, which imports the barrel again - a cycle. The cycle resolves, but
     * it leaves the entry module's tail unreached, so every `window.enggX` and
     * `window.datum` was simply absent on a normal page load. Nothing threw, so
     * there was no error to find: the app rendered, the menu bar built itself,
     * and only the last few statements were silently skipped.
     *
     * The fix is not to reorder the entry module - the cycle would still decide
     * where the tail lands - but to stop the handles depending on reaching it.
     * The barrel installs them as well, so they are present whichever module the
     * graph finishes on. Calling twice is harmless: this assigns the same names
     * to the same objects, and `installed` records that it has happened so a
     * reader can tell the difference between "ran" and "ran twice".
     */
    if (target.__enggAutomationHooksInstalled) {
        return target.__enggAutomationHooksInstalled;
    }

    Object.assign(target, {
        enggDocumentFile,
        enggDrawing,
        enggDrawingExport,
        enggDrawingReference,
        enggDrawingRenderer,
        enggDrawingSheets,
        enggDrawingState,
        enggErrorLog,
        enggFileSave,
        enggAxisLabels,
        enggDrawOrder,
        enggDimensionPlacement,
        enggDimensionInference,
        enggDimensionPreview,
        enggHitTesting,
        enggEditorState: editorState,

        /*
         * THE LIVE DRAWING MODEL, which is what `enggEditorState` is NOT.
         *
         * The two are easy to confuse by name and are genuinely different
         * things: `editorState` holds UI state - which panel tab is open, the
         * drag in progress - while the drawing model, its grid, its snapping
         * settings and its objects live on `drawingState`. The browser tooling
         * needs the model: reading the grid's visibility or grid snapping from
         * the UI state would always report `undefined`, which is exactly what
         * made a snap-control check look like it had failed when the controls
         * were in fact working.
         */
        enggDrawingStateLive: drawingState,
        enggLoadProfile,
        enggOpenPopup,
        enggRecentFiles,
        enggRecovery,
        enggSheets,
        enggTemplates,
        enggTransforms,
        enggUi,
        enggWrittenReferences
    });

    /*
     * The marker is what makes the guard above work, and it is written LAST so
     * a call that somehow failed half way does not leave the handles marked as
     * installed when they are not.
     */
    target.__enggAutomationHooksInstalled = true;

    return true;
}

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
import enggDocumentFile from "../file/document-file.js";
import enggDrawingExport from "../file/document-export.js";
import enggRecovery from "../file/document-recovery.js";
import enggRecentFiles from "../file/recent-files.js";
import enggTemplates from "../file/templates.js";
import enggErrorLog from "./error-log.js";
import enggFileSave from "../file/file-save.js";
import enggAxisLabels from "../core/geometry/axis-labels.js";
import enggVariableDimension from "../features/dimensions/variable-dimension.js";
import enggDrawOrder from "../editor/commands/draw-order.js";
import * as enggDimensionPlacement from "../editor/annotate/dimension-placement.js";
import * as enggDimensionInference from "../editor/annotate/dimension-inference.js";
import * as enggDimensionPreview from "../editor/geometry/preview.js";
import * as enggHitTesting from "../editor/interaction/hit-testing.js";
import enggLoadProfile from "../features/analysis/load-profile.js";
import { editorState } from "../editor/editor-state.js";
import enggDrawingReference from "../references/drawing-reference.js";
import enggDrawingRenderer from "../rendering/renderer.js";
import enggDrawingState from "../core/model/drawing-state.js";
import enggSheets from "../sheets/sheets.js";
import enggOpenPopup from "../ui/open-popup.js";
import enggUi from "../ui/ui.js";
import enggWrittenReferences from "../solution/written-references.js";
import { enggDrawing, enggDrawingSheets, enggTransforms } from "../editor/index.js";

export function installAutomationHooks(target = window) {
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
        enggVariableDimension,
        enggDrawOrder,
        enggDimensionPlacement,
        enggDimensionInference,
        enggDimensionPreview,
        enggHitTesting,
        enggEditorState: editorState,
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
}

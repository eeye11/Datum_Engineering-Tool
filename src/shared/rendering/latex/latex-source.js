/*
 * ============================================================
 * THE LaTeX / TikZ SOURCE SYSTEM
 * ============================================================
 *
 * The one place the drawing-source architecture is described. Each module owns
 * a single responsibility and this file names them, so the boundaries are
 * visible without reading all of them:
 *
 *   drawing-source.js           the canonical source representation, the
 *                               markers and the picture builder.
 *   source-mapping.js           object id <-> source region, targeted updates.
 *   source-synchronization.js   the model/editor/renderer coordination.
 *   source-validation.js        what can be said about the draft without TeX.
 *   rendering-adapter.js        the ONE door to the existing render endpoint.
 *   drawing-source-manager.js   owns the current drawing's source and its
 *                               dirty/rendered state.
 *
 * A drawing source is the tikzpicture that generates the drawing. The renderer
 * wrapper (packages, document environment) is the server's and is never shown
 * in the Source tab. A tool template is a construction used to CREATE an
 * object; it is not a drawing source. The three are deliberately distinct.
 */

export * as drawingSource from "./drawing-source.js";
export * as sourceMapping from "./source-mapping.js";
export * as sourceSynchronization from "./source-synchronization.js";
export * as sourceValidation from "./source-validation.js";
export * as renderingAdapter from "./rendering-adapter.js";
export * as sourceManager from "./drawing-source-manager.js";

export {
    PICTURE_BEGIN,
    PICTURE_END,
    PICTURE_OPTIONS,
    emptyDrawingSource,
    parseDrawingSource,
    buildDrawingSource,
    createSourceMap,
    objectRegion
} from "./drawing-source.js";

export {
    setObjectRegion,
    removeObjectRegion,
    regionForObject,
    objectIdAtLine,
    mappedObjectIds,
    reconcileSourceWithObjects,
    sourceBlocks
} from "./source-mapping.js";

export {
    renderDrawingSource,
    wrapForRendering,
    rendererStatus
} from "./rendering-adapter.js";

export {
    createSourceManager,
    activeSourceManager,
    resetActiveSourceManager
} from "./drawing-source-manager.js";

export {
    validateDrawingSource,
    validationSummary
} from "./source-validation.js";

export {
    setSourceWriter,
    addSourceWriter,
    registeredSourceWriters,
    sourceForObject,
    writeObjectIntoSource,
    removeObjectFromSource,
    readSourceInto,
    applySourceToModel
} from "./source-synchronization.js";

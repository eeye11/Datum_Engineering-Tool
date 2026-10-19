/*
 * Drawing the editor's canvas.
 */

import enggDrawingState from "../../../shared/model/drawing-state.js";
import enggDrawingRenderer from "../../../shared/rendering/renderer.js";
import { SVG_NAMESPACE } from "../../../features/workspace/constants.js";
import { drawingCanvas, drawingZoomValue } from "../../../features/workspace/dom.js";
import { drawingState, editorState } from "../../../features/workspace/editor-state.js";
import { renderProperties } from "../panels/feature-panel.js";
import { updateHistoryControls } from "../toolbar/tool-activation.js";
import { activeSourceManager } from "../../../shared/rendering/latex/drawing-source-manager.js";
import { createSourceMap, visibleDrawingSource } from "../../../shared/rendering/latex/drawing-source.js";
import { renderDrawingSource } from "../../../shared/rendering/latex/rendering-adapter.js";
import { validateDrawingSource } from "../../../shared/rendering/latex/source-validation.js";

/*
 * ============================================================
 * THE DRAWING SPACE IS DRAWN FROM THE SOURCE
 * ============================================================
 *
 * THE MODEL DRAWS THE OVERLAY, THE SOURCE DRAWS THE PICTURE.
 *
 * The object model is the model of what the student drew, and it is what hit
 * testing, selection, snapping and Features act on. It is NOT the picture: the
 * picture in the Drawing Space is the compiled output of the document's TikZ
 * source - the SAME text the Source tab shows and edits. So:
 *
 *   - every committed model change generates source (drawing-panel.js) and
 *     asks the manager for a revision bump;
 *   - a revision bump schedules a compile of the CURRENT source;
 *   - the compiled SVG replaces the previous picture in the canvas;
 *   - the canvas then draws only the interaction overlay on top - grid,
 *     selection outlines and handles, snap markers, previews - which are aids,
 *     not the drawing.
 *
 * WHY A SEPARATE OVERLAY SVG RATHER THAN DRAWING THE OVERLAY INTO THE PICTURE.
 * The compiled picture must be untouched by the editor: a selection outline is
 * not part of the drawing and must never reach an export. Two stacked layers
 * give exactly that, and the lower one is literally the renderer's output.
 *
 * WHEN COMPILATION IS NOT AVAILABLE. The source is still authoritative. The
 * cache keeps the last successfully compiled picture, and a source that fails
 * to compile keeps the previous picture visible while the error is reported -
 * it is never silently replaced by a model-drawn sheet pretending to be the
 * source's output.
 */

const PICTURE_LAYER_CLASS = "drawing-source-layer";
const OVERLAY_CLASS = "drawing-overlay";

/*
 * A sheet changed by a drag reports the pointer many times a second, and every
 * report would otherwise be a separate compile. The compile waits this long
 * after the last change; the overlay moves immediately, so dragging stays
 * responsive while the committed picture follows a moment later.
 */
const SOURCE_RENDER_DELAY_MS = 180;

/* revision -> svg. A small LRU: Undo and Redo revisit versions constantly. */
const CACHE_LIMIT = 24;

let compiledCache = new Map();
let compileTimer = null;
let compileToken = 0;
let compiledRevision = null;
let lastCompiledSvg = null;
let lastCompileError = null;
let inFlight = null;

function createSvgElement(
    name,
    attributes = {}
) {
    const element =
        document.createElementNS(
            SVG_NAMESPACE,
            name
        );

    Object.entries(
        attributes
    ).forEach(
        ([key, value]) => {
            element.setAttribute(
                key,
                String(value)
            );
        }
    );

    return element;
}

function appendArrowhead(
    group,
    x,
    y,
    direction
) {
    let points;

    if (
        direction ===
        "x"
    ) {
        points =
            `${x},${y} ${x - 7},${y - 4} ${x - 7},${y + 4}`;
    } else if (
        direction ===
        "x-negative"
    ) {
        points =
            `${x},${y} ${x + 7},${y - 4} ${x + 7},${y + 4}`;
    } else if (
        direction ===
        "y"
    ) {
        points =
            `${x},${y} ${x - 4},${y + 7} ${x + 4},${y + 7}`;
    } else {
        points =
            `${x},${y} ${x - 4},${y - 7} ${x + 4},${y - 7}`;
    }

    group.appendChild(
        createSvgElement(
            "polygon",
            {
                points,

                fill:
                    "#000000",

                stroke:
                    "none"
            }
        )
    );
}

export function appendCoordinateSystemVisual(
    svg,
    object,
    isSelected = false
) {
    const geometry = object.geometry;

    const bounds = {
        width:
            drawingCanvas.clientWidth,

        height:
            drawingCanvas.clientHeight
    };

    const origin =
        enggDrawingState.engineeringToScreen(
            object.geometry.origin,
            bounds,
            drawingState
        );

    const scale =
        enggDrawingState.BASE_PIXELS_PER_UNIT *
        drawingState.camera.zoom;

    const length =
        Math.max(
            15,
            object.geometry.axisLength *
                scale
        );

    const stroke =
        isSelected
            ? "#17643b"
            : (
                object.style?.stroke ||
                "#000000"
            );

    const strokeWidth =
        isSelected
            ? 2
            : Math.max(
                1,
                Number(
                    object.style?.lineWidth
                ) || 1.25
            );

    const group =
        createSvgElement(
            "g",
            {
                class:
                    "drawing-coordinate-system"
            }
        );

    group.appendChild(
        createSvgElement(
            "line",
            {
                x1:
                    origin.x -
                    length,

                y1:
                    origin.y,

                x2:
                    origin.x +
                    length,

                y2:
                    origin.y,

                stroke,

                "stroke-width":
                    strokeWidth
            }
        )
    );

    group.appendChild(
        createSvgElement(
            "line",
            {
                x1:
                    origin.x,

                y1:
                    origin.y +
                    length,

                x2:
                    origin.x,

                y2:
                    origin.y -
                    length,

                stroke,

                "stroke-width":
                    strokeWidth
            }
        )
    );

    appendArrowhead(
        group,
        origin.x + length,
        origin.y,
        "x"
    );

    appendArrowhead(
        group,
        origin.x - length,
        origin.y,
        "x-negative"
    );

    appendArrowhead(
        group,
        origin.x,
        origin.y - length,
        "y"
    );

    appendArrowhead(
        group,
        origin.x,
        origin.y + length,
        "y-negative"
    );

    group.appendChild(
        createSvgElement(
            "circle",
            {
                cx:
                    origin.x,

                cy:
                    origin.y,

                r:
                    isSelected
                        ? 4
                        : 3,

                fill:
                    "#ffffff",

                stroke,

                "stroke-width":
                    strokeWidth
            }
        )
    );

    /*
     * THE AXIS LABELS ARE THE FEATURE'S OWN TEXT.
     *
     * The four fixed "+X / -X / +Y / -Y" strings are gone. A coordinate system
     * carries an X label and a Y label, drawn at the positive end of each axis,
     * with "X" and "Y" as the values a new one starts with.
     *
     * AN EMPTY LABEL IS DRAWN AS NOTHING, deliberately. Clearing the field is how
     * a student says "no label here", so rendering a fallback would silently
     * overrule them.
     *
     * A label with a STORED POSITION is drawn there - that position is the
     * student's, and it is what makes the label a movable annotation rather than
     * a piece of the axis. Without one it sits at its automatic place beside the
     * axis end, which is where it has always been drawn.
     */
    const labelText = (value) => String(value ?? "");
    const xText = labelText(geometry.xLabel ?? "X");
    const yText = labelText(geometry.yLabel ?? "Y");

    const appendAxisLabel = (text, automatic, manual) => {
        if (!text.trim()) {
            return;
        }

        const label = createSvgElement(
            "text",
            {
                x: Number.isFinite(manual?.x) ? manual.x : automatic.x,
                y: Number.isFinite(manual?.y) ? manual.y : automatic.y,
                fill: stroke,
                "font-size": 13,
                "font-family": "Arial, sans-serif",
                "font-weight": "600",

                /*
                 * Tagged so the SAME hit test that finds any other feature can
                 * find this label, and so a drag can tell which of the two is
                 * being moved. The tag is editor-only presentation metadata; it
                 * is not part of the drawing's geometry.
                 */
                "data-axis-label": text === xText ? "x" : "y"
            }
        );

        label.textContent = text;

        group.appendChild(label);
    };

    appendAxisLabel(
        xText,
        { x: origin.x + length + 5, y: origin.y - 6 },
        geometry.xLabelPosition
    );

    appendAxisLabel(
        yText,
        { x: origin.x + 6, y: origin.y - length - 5 },
        geometry.yLabelPosition
    );

    const originLabel =
        createSvgElement(
            "text",
            {
                x:
                    origin.x +
                    7,

                y:
                    origin.y +
                    16,

                fill:
                    stroke,

                "font-size":
                    10,

                "font-family":
                    "Arial, sans-serif"
            }
        );

    originLabel.textContent =
        "0";

    group.appendChild(
        originLabel
    );

    svg.appendChild(
        group
    );
}

/*
 * ================================================================
 * ONE DRAW PER FRAME WHILE THE POINTER MOVES
 * ================================================================
 *
 * A pointer reports far more often than the screen repaints, and a drag
 * fires BOTH `mousemove` and `pointermove` for every movement - each of
 * which redrew the whole sheet. `requestRender` is what the per-move paths
 * call instead: however many times it is asked within a frame, the sheet is
 * drawn once, just before the browser paints.
 *
 * `renderCurrentDrawing` itself is unchanged and still draws at once, so a
 * click, a commit or a key press shows its result immediately - and it
 * cancels any frame still pending, since what it just drew is already
 * current. Without `requestAnimationFrame` (a test harness) it draws at once.
 */
let pendingFrame = 0;

export function requestRender() {
    if (typeof requestAnimationFrame !== "function") {
        renderCurrentDrawing();
        return;
    }

    if (pendingFrame) {
        return;
    }

    pendingFrame = requestAnimationFrame(() => {
        pendingFrame = 0;
        renderCurrentDrawing();
    });
}

/*
 * ============================================================
 * THE LAYERS
 * ============================================================
 *
 * `ensureLayer` makes (or finds) one element of a given class inside the
 * canvas. The picture layer is the compiled source; the overlay is everything
 * the model draws for interaction. Both are routinely cleared and refilled.
 */
function ensureLayer(canvas, className) {
    let layer = canvas.querySelector(`:scope > svg.${className}`);

    /*
     * THE OLD MODEL-DRAWN PICTURE IS REMOVED IF ONE IS STILL THERE.
     *
     * Earlier versions left an `svg.drawing-renderer` in the canvas and
     * repainted every feature into it. Nothing writes to it any more, but a
     * canvas that still HAD one - a page kept alive across a deployment, a
     * harness that built its own - would go on showing a second, stale drawing
     * under the compiled one. Creating either layer is the moment the canvas is
     * recognised as the new one, so that is where the old picture is dropped.
     */
    canvas.querySelectorAll(":scope > svg.drawing-renderer").forEach((stale) => stale.remove());

    if (!layer) {
        layer = globalThis.document.createElementNS(SVG_NAMESPACE, "svg");
        layer.classList.add(className);
        layer.setAttribute("aria-hidden", "true");
        canvas.appendChild(layer);
    }

    return layer;
}

function sizeLayer(layer, bounds) {
    const width = Math.max(1, Math.round(bounds.width));
    const height = Math.max(1, Math.round(bounds.height));

    layer.setAttribute("viewBox", `0 0 ${width} ${height}`);
    layer.setAttribute("width", String(width));
    layer.setAttribute("height", String(height));
}

/* The canvas bounds the picture is fitted into. */
function canvasBounds() {
    const bounds = drawingCanvas.getBoundingClientRect();

    if (!bounds.width || !bounds.height) {
        return {
            width: drawingCanvas.clientWidth || 900,
            height: drawingCanvas.clientHeight || 600
        };
    }

    return bounds;
}

/*
 * WHERE THE WORLD APPEARS IN THE PICTURE.
 *
 * The picture is drawn in drawing units (millimetres on paper), from (0,0) up
 * and to the right. The canvas shows world points through the camera:
 *
 *     screen.x = width / 2 + (x - panX) * k
 *     screen.y = height / 2 - (y - panY) * k
 *
 * so a world point (panX, panY) belongs at the canvas centre, and one drawing
 * unit is `k` screen pixels. The picture is positioned with exactly that
 * transform, which keeps the compiled drawing on the same world coordinates
 * as the snapping, the handles and every other piece of interaction code.
 *
 * It is written as viewBox + width/height rather than an SVG transform so the
 * renderer's own coordinates are never rewritten: the source's numbers are the
 * drawing's numbers.
 */
function positionPictureLayer(layer, bounds, state) {
    const zoom = Number(state?.camera?.zoom) || 1;
    const k = enggDrawingState.BASE_PIXELS_PER_UNIT * zoom;
    const panX = Number(state?.camera?.panX) || 0;
    const panY = Number(state?.camera?.panY) || 0;

    const viewWidth = Math.max(1, bounds.width / k);
    const viewHeight = Math.max(1, bounds.height / k);

    layer.setAttribute(
        "viewBox",
        `${panX - viewWidth / 2} ${-panY - viewHeight / 2} ${viewWidth} ${viewHeight}`
    );
    layer.setAttribute("x", "0");
    layer.setAttribute("y", "0");
    layer.setAttribute("width", String(bounds.width));
    layer.setAttribute("height", String(bounds.height));
    layer.setAttribute("preserveAspectRatio", "xMidYMid meet");
}

/*
 * Put a compiled picture into the canvas.
 *
 * The compiled SVG is cloned in as-is: it is the renderer's output, and nothing
 * here edits its geometry. Its own width/height are dropped so the layer's
 * size decides, and every element is made non-interactive - the overlay and
 * the model own the pointer.
 */
function showPicture(svg) {
    const layer = ensureLayer(drawingCanvas, PICTURE_LAYER_CLASS);

    layer.replaceChildren();

    if (!svg) {
        return false;
    }

    const root = svg.tagName && svg.tagName.toLowerCase() === "svg" ? svg : null;
    const nodes = root ? [...root.childNodes] : [svg];

    nodes.forEach((node) => layer.appendChild(node.cloneNode(true)));

    layer.dataset.rendered = "source";

    return true;
}

/*
 * ============================================================
 * COMPILING THE SOURCE
 * ============================================================
 */

/*
 * THE FAILURE IS CHECKED BEFORE THE DEBOUNCE.
 *
 * `reportCompileError` runs when the invalid draft is noticed - the moment the
 * editor or the panel changes the source - so the reason is on screen while the
 * student is still looking at the character they just broke. Waiting for a
 * scheduled compile to report it would be a delay with nothing behind it: the
 * answer is already known and the compile is never going to be sent.
 */
if (typeof globalThis.document !== "undefined" && globalThis.document) {
    globalThis.document.addEventListener("datum:source-changed", () => {
        const manager = activeSourceManager();
        const validation = validateDrawingSource(manager.getSource());

        if (!validation.ok) {
            reportCompileError(
                validation.diagnostics.find((entry) => entry.severity === "error")?.message ||
                    "Invalid TikZ source"
            );

            return;
        }

        lastCompileError = null;
    });
}

function cachedPicture(revision) {
    return compiledCache.has(revision) ? compiledCache.get(revision) : null;
}

function rememberPicture(revision, svg) {
    compiledCache.set(revision, svg);

    while (compiledCache.size > CACHE_LIMIT) {
        compiledCache.delete(compiledCache.keys().next().value);
    }
}

function reportCompileError(message) {
    const text = message instanceof Error ? message.message : String(message ?? "");

    if (text === lastCompileError) {
        return;
    }

    lastCompileError = text;

    /*
     * The error is VISIBLE, through the same document event the Source tab
     * uses to report a failed render. The Source keeps its text, and the
     * Drawing Space keeps the last picture that compiled - it does not fall
     * back to a model-drawn sheet.
     */
    try {
        const view = globalThis.document?.defaultView || globalThis;
        const Custom = view.CustomEvent || globalThis.CustomEvent;

        /*
         * AN EVENT ONLY WHERE THERE IS AN EVENT TO MAKE. A test harness without
         * `CustomEvent` gets the reported status (`lastCompiledError`) instead
         * of half-constructed event that throws on dispatch.
         */
        if (typeof Custom === "function" && globalThis.document) {
            globalThis.document.dispatchEvent(
                new Custom("datum:source-render-error", { detail: { message: text } })
            );
        }
    } catch {
        /* Reporting must never be the thing that breaks the render. */
    }
}

/*
 * ASK FOR A COMPILE OF THE CURRENT SOURCE.
 *
 * `immediately` is used on load, on Undo/Redo and on a committed gesture, where
 * there is nothing to coalesce. The ordinary path is debounced.
 */
export function requestSourceRender({ immediately = false } = {}) {
    const manager = activeSourceManager();
    const revision = manager.revision();

    if (cachedPicture(revision)) {
        compiledRevision = revision;
        lastCompiledSvg = cachedPicture(revision);
        renderCurrentDrawing();

        return;
    }

    if (compileTimer) {
        clearTimeout(compileTimer);
        compileTimer = null;
    }

    if (immediately) {
        compileCurrentSource();

        return;
    }

    compileTimer = setTimeout(() => {
        compileTimer = null;
        compileCurrentSource();
    }, SOURCE_RENDER_DELAY_MS);
}

async function compileCurrentSource() {
    const manager = activeSourceManager();
    const source = manager.getSource();
    const revision = manager.revision();

    const validation = validateDrawingSource(source);

    if (!validation.ok) {
        /*
         * A source that cannot even be parsed is not sent. The previous
         * picture stays, and the reason is reported.
         */
        reportCompileError(
            validation.diagnostics.find((entry) => entry.severity === "error")?.message ||
                "Invalid TikZ source"
        );

        return false;
    }

    if (cachedPicture(revision)) {
        compiledRevision = revision;
        lastCompiledSvg = cachedPicture(revision);
        lastCompileError = null;
        renderCurrentDrawing();

        return true;
    }

    const token = (compileToken += 1);

    try {
        inFlight = renderDrawingSource(visibleDrawingSource(source));

        const svg = await inFlight;

        /*
         * A NEWER COMPILE STARTED WHILE THIS ONE WAS RUNNING. Its result
         * describes an older draft, so it is DISCARDED rather than drawn -
         * which is what keeps a stale picture from appearing after a newer
         * edit.
         */
        if (token !== compileToken) {
            return false;
        }

        rememberPicture(revision, svg);

        compiledRevision = revision;
        lastCompiledSvg = svg;
        lastCompileError = null;

        manager.markRendered(source, revision);
        renderCurrentDrawing();

        return true;
    } catch (error) {
        if (token !== compileToken) {
            return false;
        }

        manager.markFailed(error);
        reportCompileError(error);

        /*
         * The last picture that worked stays on screen. Nothing is drawn in
         * its place, because pretending a broken source rendered would be a
         * lie about the drawing.
         */
        renderCurrentDrawing();

        return false;
    } finally {
        inFlight = null;
    }
}

/*
 * The revision of the source the Drawing Space is currently showing, or null
 * when it is showing nothing that was compiled. Used by diagnostics and tests.
 */
export function renderedSourceRevision() {
    return compiledRevision;
}

export function lastCompiledError() {
    return lastCompileError;
}

/* Drop the cache - a document reset, a sheet load with a different source. */
/* Published under the name `sheets.js` calls, without a direct import. */
globalThis.enggDrawingPictureCache = {
    reset: () => resetSourcePictureCache()
};

export function resetSourcePictureCache() {
    compiledCache = new Map();
    compiledRevision = null;
    lastCompiledSvg = null;
    lastCompileError = null;
}

/* Export the current compiled picture, for an embed that must not recompile. */
export function currentCompiledPicture() {
    return lastCompiledSvg;
}

/* The object id whose source region holds a given source line. */
export function objectIdAtSourceLine(line) {
    return createSourceMap(activeSourceManager().getSource()).idAtLine(line);
}

export function renderCurrentDrawing() {
    if (pendingFrame) {
        cancelAnimationFrame(pendingFrame);
        pendingFrame = 0;
    }

    drawingCanvas.classList.toggle(
        "drawing-tool-active",
        Boolean(
            drawingState.activeTool
        )
    );

    /*
     * ================================================================
     * DERIVED FEATURES ARE DERIVED ON THE WAY TO THE CANVAS
     * ================================================================
     *
     * A Components pair and a Resultant are not facts about a force; they are
     * statements ABOUT one, and go stale the instant the force changes. So
     * they cannot be refreshed only when an edit is committed.
     *
     * They used to be, and that is why they looked broken. A drag mutates
     * the force on every pointermove and commits once, on release - so the
     * arrow followed the cursor smoothly while its decomposition sat frozen
     * at the value it had when the student first pressed down. The same gap
     * appeared for every uncommitted path: a live resize, a preview, a
     * handle being dragged. Committing was never the missing refresh; it was
     * the only refresh there was.
     *
     * So the refresh goes HERE, in the one function every draw already
     * passes through. That is what makes it complete rather than a longer
     * list of call sites to remember: there is no way to move a force and
     * render it without passing through this. A tool added next month
     * inherits the behaviour by rendering, which is the property worth
     * having, instead of depending on whoever wrote it remembering a call.
     *
     * RECORDS NOTHING. This is a consequence of an edit, not an edit of its
     * own, so the history is untouched - a drag remains one undo entry
     * however many times the pointer moved and however many objects the
     * refresh touched. `commitDrawingChange` still refreshes before it
     * snapshots, so a restored state is consistent; doing it here as well
     * only means the undo entry describes what was on screen at the time.
     *
     * The cost is a map lookup per object on a draw that has already done a
     * full canvas repaint, which is why the registry returns immediately when
     * nothing depends on anything.
     */
    enggDrawingState.refreshDerivedFeatures(drawingState);

    /*
     * ================================================================
     * THE PICTURE IS THE SOURCE'S; THE MODEL DRAWS THE OVERLAY ON TOP
     * ================================================================
     *
     * The compiled source is kept in its own layer and moved with the camera.
     * The model then draws only what the student is DOING - selection outlines,
     * handles, the live construction preview, snap feedback - into a second,
     * transparent layer above it.
     *
     * If the current source has not compiled yet (the very first paint, or a
     * revision still waiting on the debounce) a compile is scheduled and the
     * LAST PICTURE THAT COMPILED is drawn. That is deliberately not the same
     * as drawing the model: the model is never presented as an output of the
     * source it did not come from.
     */
    const bounds = canvasBounds();
    const manager = activeSourceManager();
    const revision = manager.revision();

    /*
     * THE PICTURE MUST DESCRIBE A SOURCE THE STUDENT CAN SEE. While the current
     * draft is invalid or fails to compile, the last good picture is shown - but
     * never a picture compiled from a DIFFERENT source left there by an earlier
     * sheet or document.
     */
    const currentValid = validateDrawingSource(manager.getSource()).ok;

    const picture = cachedPicture(revision) || (currentValid ? lastCompiledSvg : null);

    const pictureLayer = ensureLayer(drawingCanvas, PICTURE_LAYER_CLASS);

    if (picture) {
        showPicture(picture);
        positionPictureLayer(pictureLayer, bounds, drawingState);
    }

    if (!cachedPicture(revision)) {
        requestSourceRender();
    }

    const overlay = ensureLayer(drawingCanvas, OVERLAY_CLASS);

    sizeLayer(overlay, bounds);

    while (overlay.firstChild) {
        overlay.removeChild(overlay.firstChild);
    }

    enggDrawingRenderer.renderDrawing(
        drawingState,
        overlay,
        { overlayOnly: true }
    );

    /*
     * THE FEATURES TAB FOLLOWS GEOMETRY CHANGED BY ANY DRAWING PATH.
     *
     * A handle drag, a live resize and a preview all mutate geometry and then
     * draw - so this, the one function every draw passes through, is where the
     * panel is told. Without it a value typed into a field and a value dragged
     * on the sheet would disagree until something else happened to re-render.
     *
     * IT USED TO BE CONDITIONAL, on a signature of the selected object, because
     * the panel it kept in step was a form of number fields that a rebuild would
     * have yanked the caret out of. The Features pane is not that: its fields are
     * appearance and identity, they are rebuilt only when the SELECTION changes,
     * and a redraw does not change the selection. So there is nothing here to
     * protect against, and the guard - and the two dataset attributes it read -
     * has gone with the panel that needed it.
     */
    renderProperties();

    updateHistoryControls();

    /*
     * The zoom readout is derived from the camera, not maintained
     * alongside it.
     *
     * There are several places that change the zoom - the buttons, the
     * wheel, the typed value, the sheet that was just loaded - and a
     * mirrored variable set at each of them is a number that can
     * disagree with the thing it mirrors. Reading it back here, in the
     * one function every draw already goes through, means the readout
     * cannot be stale however the zoom was changed, and the buttons
     * that step from it cannot step from a wrong number.
     */
    editorState.drawingZoom =
        drawingState.camera.zoom * 100;

    if (drawingZoomValue) {
        drawingZoomValue.value =
            `${Math.round(editorState.drawingZoom)}%`;
    }
}

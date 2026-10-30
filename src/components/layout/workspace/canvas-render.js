/*
 * Drawing the editor's canvas.
 */

import enggDrawingState from "../../../shared/model/drawing-state.js";
import enggDrawingRenderer from "../../../shared/rendering/renderer.js";
import enggCanvasStroke from "../../../shared/rendering/canvas-stroke-constants.js";
import { SVG_NAMESPACE } from "../../../features/workspace/constants.js";
import { drawingCanvas, drawingZoomValue } from "../../../features/workspace/dom.js";
import { drawingState, editorState } from "../../../features/workspace/editor-state.js";
import { renderProperties } from "../panels/feature-panel.js";
import { updateHistoryControls } from "../toolbar/tool-activation.js";
import { activeSourceManager } from "../../../shared/rendering/latex/drawing-source-manager.js";
import { createSourceMap } from "../../../shared/rendering/latex/drawing-source.js";
import { renderDrawingSource } from "../../../shared/rendering/latex/rendering-adapter.js";
import { validateDrawingSource } from "../../../shared/rendering/latex/source-validation.js";
import { prepareRenderInput } from "../../../shared/rendering/latex/source-statements.js";

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

/*
 * A failure that says nothing about the source - the engine is still loading,
 * the server cannot be reached - is retried after this long, doubling up to
 * the cap. A failure that IS about the source is not retried at all: the same
 * text would fail the same way, so it waits for the next edit.
 */
const TRANSIENT_RETRY_MS = 1000;
const TRANSIENT_RETRY_CAP_MS = 8000;

let compiledCache = new Map();
let compileTimer = null;
let compiledRevision = null;
let lastCompiledSvg = null;
let lastCompileError = null;

/*
 * WHAT KIND OF MESSAGE `lastCompileError` IS.
 *
 * A renderer failure (`true`) is the compiler refusing the source; a draft
 * diagnostic (`false`) is the student's own unfinished statement. Only the
 * first is answered by a picture arriving - see the clear in
 * `compileCurrentSource`.
 */
let lastCompileErrorIsRendererFailure = true;

/*
 * WHAT EACH OBJECT LOOKED LIKE WHEN A SOURCE REVISION WAS WRITTEN.
 *
 * revision -> Map(object id -> serialised object). Recorded the first time a
 * revision is drawn, which is straight after the commit that wrote it. Comparing
 * the model with the record for the picture on screen says which objects the
 * picture does not show yet - see `objectsThePictureDoesNotShow`.
 */
let modelAtRevision = new Map();

/* The current source's object regions, parsed once per revision. */
let regionsRevision = null;
let regionsMap = null;

/*
 * THE SCHEDULER'S STATE, ALL KEYED BY SOURCE REVISION.
 *
 *   scheduledRevision  the revision the debounce timer will compile
 *   inFlightRevision   the revision being compiled right now, or null
 *   failedRevision     the last revision whose SOURCE failed to compile
 *
 * Keying by revision rather than by "the latest request" is what keeps the
 * picture moving. A redraw asks for the current revision many times a second -
 * every pointer move over the canvas - and each request used to restart the
 * debounce and cancel the compile already running. While the pointer moved, no
 * compile ever finished: the Source tab showed the new code and the Drawing
 * Space never caught up. Now a request for a revision that is already
 * scheduled, running or known to fail is a no-op.
 */
let scheduledRevision = null;
let inFlightRevision = null;
let failedRevision = null;
let transientRetryMs = TRANSIENT_RETRY_MS;

/* Bumped when the cache is reset for another document; see the reset below. */
let generation = 0;

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
 * The source is written in drawing units (`x=1mm, y=1mm`). The canvas shows
 * world points through the camera:
 *
 *     screen.x = width / 2 + (x - panX) * k
 *     screen.y = height / 2 - (y - panY) * k
 *
 * so a world point (panX, panY) belongs at the canvas centre, and one drawing
 * unit is `k` screen pixels.
 *
 * THE COMPILED SVG IS NOT IN DRAWING UNITS. TeX writes TeX points, y downward,
 * and places the page one inch in - so with the picture anchored at its (0,0)
 * (the canvas asks for that; see server/tikz.js) a world point lands at
 *
 *     svg.x = PICTURE_ORIGIN + x * POINTS_PER_UNIT
 *     svg.y = PICTURE_ORIGIN - y * POINTS_PER_UNIT
 *
 * The visible world rectangle is converted with exactly that map, so the
 * compiled drawing sits on the same world coordinates as the snapping, the
 * handles and every other piece of interaction code. Reading the SVG as if it
 * were millimetres from the origin - as this used to - drew the picture about
 * 2.8 times too large and shifted by its bounding box, away from the objects
 * the student was clicking.
 *
 * It is written as a viewBox rather than an SVG transform so the renderer's own
 * coordinates are never rewritten.
 */
const POINTS_PER_UNIT = 72.27 / 25.4;
const PICTURE_ORIGIN = -72.27;

function positionPictureLayer(layer, bounds, state) {
    const zoom = Number(state?.camera?.zoom) || 1;
    const k = enggDrawingState.BASE_PIXELS_PER_UNIT * zoom;
    const panX = Number(state?.camera?.panX) || 0;
    const panY = Number(state?.camera?.panY) || 0;

    const viewWidth = Math.max(1, bounds.width / k);
    const viewHeight = Math.max(1, bounds.height / k);

    const left = PICTURE_ORIGIN + (panX - viewWidth / 2) * POINTS_PER_UNIT;
    const top = PICTURE_ORIGIN - (panY + viewHeight / 2) * POINTS_PER_UNIT;

    layer.setAttribute(
        "viewBox",
        `${left} ${top} ${viewWidth * POINTS_PER_UNIT} ${viewHeight * POINTS_PER_UNIT}`
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

    /*
     * THE SAME PICTURE IS NOT CLONED AGAIN. Every redraw - every pointer move of
     * a drag - passes through here, and re-cloning an unchanged compiled picture
     * each time was work the student felt as lag. Only a new picture is cloned;
     * the camera is applied separately by `positionPictureLayer`.
     */
    if (svg && layer.__shownPicture === svg) {
        return true;
    }

    layer.replaceChildren();
    layer.__shownPicture = null;

    if (!svg) {
        return false;
    }

    const root = svg.tagName && svg.tagName.toLowerCase() === "svg" ? svg : null;
    const nodes = root ? [...root.childNodes] : [svg];

    nodes.forEach((node) => layer.appendChild(node.cloneNode(true)));

    showStrokesAtScreenWidth(layer);

    layer.__shownPicture = svg;
    layer.dataset.rendered = "source";

    return true;
}

/*
 * ============================================================
 * AN OBJECT IS NEVER SHOWN ONLY WHERE IT USED TO BE
 * ============================================================
 *
 * The Drawing Space is the compiled source, and a compile takes a moment. Until
 * it lands, an object the student is moving - or has just drawn or edited -
 * would be shown where it USED to be, or not at all, with only a dashed outline
 * where it really is. With the render server not running, nothing would ever
 * appear.
 *
 * So every object whose model differs from what the picture on screen was
 * compiled from is drawn live by the overlay, and with no picture at all every
 * object is. Once the new picture arrives the two agree and the live drawing
 * steps aside.
 */
function serialiseObject(object) {
    try {
        return JSON.stringify(object);
    } catch {
        return null;
    }
}

function rememberModelAt(revision) {
    if (revision === null || revision === undefined || modelAtRevision.has(revision)) {
        return;
    }

    modelAtRevision.set(
        revision,
        new Map((drawingState.objects || []).map((object) => [object.id, serialiseObject(object)]))
    );

    while (modelAtRevision.size > CACHE_LIMIT) {
        modelAtRevision.delete(modelAtRevision.keys().next().value);
    }
}

/*
 * AN OBJECT THE SOURCE HOLDS NO REGION FOR is never in any compiled picture -
 * its writer is missing or failed - so it is drawn live too. Whatever the
 * source can or cannot express, what the student drew is on the sheet.
 */
function sourceRegionsAt(revision) {
    if (regionsRevision !== revision || !regionsMap) {
        try {
            regionsMap = createSourceMap(activeSourceManager().getSource());
        } catch {
            regionsMap = null;
        }

        regionsRevision = revision;
    }

    return regionsMap;
}

function objectsThePictureDoesNotShow(pictureRevision, revision) {
    const objects = drawingState.objects || [];
    const shown = pictureRevision === null || pictureRevision === undefined
        ? null
        : modelAtRevision.get(pictureRevision);

    if (!shown) {
        return new Set(objects.map((object) => object.id));
    }

    const regions = sourceRegionsAt(revision);
    const live = new Set();

    objects.forEach((object) => {
        /*
         * A HIDDEN OBJECT IS NEVER DRAWN LIVE.
         *
         * This set is "objects whose MODEL the compiled picture does not show,
         * so draw them here instead" - it exists so a feature being dragged or
         * one with no source region is still visible on the sheet. But hiding an
         * object CHANGES ITS SERIALISATION (`visible` is part of the stored
         * object), so it matches this test and was drawn by the overlay: the eye
         * said "hidden" and the drawing went on showing it, in ADDITION to the
         * block being removed from the source.
         *
         * A hidden object is absent from the source on purpose, so it must be
         * absent from every layer. `visible` governs DRAWING, and this is a
         * drawing decision.
         */
        if (object.visible === false) {
            return;
        }

        if (shown.get(object.id) !== serialiseObject(object) || (regions && !regions.has(object.id))) {
            live.add(object.id);
        }
    });

    return live;
}

/*
 * ============================================================
 * STROKES ARE SHOWN AT SCREEN WIDTH, AS THE MODEL DREW THEM
 * ============================================================
 *
 * The compiled picture carries PRINT line widths, in points, and the generator
 * writes them as `lineWidth` x `SCREEN_PIXELS_PER_LINE_WIDTH` - the SAME number
 * the model paints the stroke at (see `tikz-style.js` and
 * `canvas-stroke-constants.js`, which owns the constant and the conversion).
 *
 * So the two agree by construction, and this function's job is to keep them
 * agreeing: it adopts the picture's stroke for the screen, never under a
 * half-pixel, and pins it against zoom so a line does not thin out as the
 * student zooms out. Nothing in the source, the saved `.tex` or an export is
 * changed - the picture states one width and the sheet shows it at that width.
 */
const MIN_SCREEN_STROKE_PX = enggCanvasStroke.MIN_SCREEN_STROKE_PX;

void MIN_SCREEN_STROKE_PX;

/*
 * THE WIDTH A COMPILED STROKE IS SHOWN AT, given what the picture states.
 *
 * THE PICTURE STATES THE WIDTH IN PT, AND ONE PT IS ONE SCREEN PIXEL HERE.
 *
 * The generated source writes `lineWidth x SCREEN_PIXELS_PER_LINE_WIDTH` pt, so
 * showing a stroke at that same number of pixels makes the compiled picture look
 * exactly like the object the model configured - which is what this function
 * enforces, and what the canvas everywhere else already assumes (one drawing
 * unit is one base pixel, per `BASE_PIXELS_PER_UNIT`).
 *
 * WHY NOT CONVERT PT TO PX THROUGH 72.27/25.4. That was tried, and it is wrong
 * in the other direction: it makes the compiled picture 2.85 times heavier than
 * the model's own overlay, so a line jumps weight the moment its compile lands.
 * The picture is a DRAWING, not a page of print, and its strokes are shown at
 * their stated size.
 *
 * A SOURCE WRITTEN BEFORE THE CONVERSION WAS FIXED is in an exported file or an
 * old draft: its widths were `lineWidth x 0.56`. Those cannot be told apart from
 * a deliberately very thin stroke by their value alone, so they are shown as
 * stated - slightly thin, never invisible - until the object is next edited and
 * its source regenerated at the current width.
 */
function shownStrokeWidth(printWidth) {
    const width = Number(printWidth);

    if (!Number.isFinite(width) || width <= 0) {
        return null;
    }

    return Math.max(MIN_SCREEN_STROKE_PX, width);
}

function showStrokesAtScreenWidth(layer) {
    layer.querySelectorAll("[stroke-width]").forEach((element) => {
        const screenWidth = shownStrokeWidth(element.getAttribute("stroke-width"));

        if (screenWidth === null) {
            return;
        }

        element.setAttribute("stroke-width", String(Number(screenWidth.toFixed(3))));
        element.setAttribute("vector-effect", "non-scaling-stroke");
    });
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
    globalThis.document.addEventListener("datum:source-changed", (event) => {
        const manager = activeSourceManager();
        const revision = event?.detail?.revision ?? manager.revision();

        /*
         * THE RENDER INPUT, NOT THE DRAFT.
         *
         * A draft with one unfinished statement is not sent as it stands - TeX
         * would stop at the mistake and return nothing for the whole sheet, which
         * is how one half-typed command used to blank the drawing. The manager
         * prepares the text the renderer gets: every unfinished statement is
         * replaced by a comment, and every complete one is compiled. So the
         * report below is about what the RENDERER will do, while the student's
         * own text keeps its mistake exactly as typed.
         */
        /*
         * THE STUDENT'S OWN DRAFT IS DIAGNOSED, AND THE MANAGER'S PLAN IS SENT.
         *
         * These are two different questions and they must not be confused.
         *
         *   WHAT IS SENT is the manager's render input: the source with its
         *   markers dropped and the statements it can safely comment out
         *   commented. Whether the compiler accepts it is the compiler's answer
         *   to give - and an attempt that will fail is still worth sending,
         *   because its failure is the honest diagnosis.
         *
         *   WHAT IS REPORTED is the state of the text the student is looking at.
         *   An unfinished statement in it is a real problem, and it is the
         *   student's to fix, so it is stated here - marked as a DRAFT
         *   diagnostic, which the successful compile that follows leaves alone
         *   (see the clear in `compileCurrentSource`).
         */
        const draft = validateDrawingSource(manager.getVisibleSource());
        const draftError = draft.diagnostics.find((entry) => entry.severity === "error");

        /*
         * THE RENDERER'S OWN TEXT IS WHAT DECIDES WHETHER TO SEND.
         *
         * The manager comments out what it cannot compile, so a draft whose
         * only problem is an unfinished statement arrives here with that
         * statement already neutralised - and if the REST of it were not
         * renderable either, sending it would cost a compile to learn what this
         * text already says.
         */
        const prepared = prepareRenderInput(manager.getVisibleSource());
        const renderable = validateDrawingSource(prepared.text);

        if (!renderable.ok || prepared.skipped.length) {
            reportCompileError(
                revision,
                draftError?.message ||
                    renderable.diagnostics.find((entry) => entry.severity === "error")?.message ||
                    "Invalid TikZ source",
                { kind: "draft" }
            );

            redrawKeepingLastPicture();

            return;
        }

        if (draftError) {
            reportCompileError(revision, draftError.message, { kind: "draft" });
            redrawKeepingLastPicture();

            return;
        }

        /*
         * A DRAFT WITH NO ERROR OF ITS OWN IS LEFT TO THE COMPILER.
         *
         * A statement that merely lacks its `;` is SENDABLE - it is either
         * half-typed or a command TeX will reject, and only TeX can tell which.
         * Guessing here would report the second case wrongly, so the compile
         * runs and the compiler's own message is what the student sees.
         */

        /*
         * NOT SENT YET, SO THERE IS NO RENDERER FAILURE TO REPORT. The previous
         * failure - if any - was about older text, and keeping it here is exactly
         * how an error outlives the mistake that caused it.
         */
        lastCompileError = null;
        lastCompileErrorIsRendererFailure = true;
    });
}

/*
 * A REDRAW THAT MUST NOT START A COMPILE.
 *
 * The canvas's ordinary redraw asks for the current revision to be rendered,
 * which is right whenever there is something new to render. Here the source has
 * just been rejected, so a redraw is a presentation update only - and it is the
 * one thing that keeps the last good picture on screen while the reason for the
 * rejection stays in view.
 */
function redrawKeepingLastPicture() {
    try {
        renderCurrentDrawing({ skipCompile: true });
    } catch {
        /* Presentation must never be the thing that breaks the report. */
    }

    /*
     * AND THE REPORT IS RE-STATED AFTER THE REDRAW.
     *
     * A compile of the PREVIOUS revision may still be in flight when this
     * runs, and when it lands it announces a successful render - correctly, for
     * that revision. The draft it is now behind is still not renderable, so the
     * reason is stated again once the picture has settled, which is what keeps
     * the message attached to the drawing the student is looking at.
     */
    const restate = () => {
        const manager = activeSourceManager();
        const prepared = prepareRenderInput(manager.getSource());
        const validation = prepared.skipped.length
            ? validateDrawingSource(manager.getSource())
            : validateDrawingSource(prepared.text);

        if (validation.ok) {
            return;
        }

        reportCompileError(
            validation.diagnostics.find((entry) => entry.severity === "error")?.message ||
                "Invalid TikZ source",
            { kind: "draft" }
        );
    };

    backgroundTimer(() => restate(), SOURCE_RENDER_DELAY_MS + 50);
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

/*
 * A FAILURE IS REPORTED WITH THE REVISION IT BELONGS TO.
 *
 * The revision is what makes a stale report impossible. A failure of revision 7
 * that arrives after the student has reached revision 9 describes text that is
 * no longer on screen, so it is dropped - and a success at revision 9 clears the
 * message outright. Without the revision, the Source tab could be shown an
 * error for a draft that had already been corrected, which is precisely the
 * "error that does not make sense" this pipeline used to produce.
 */
function reportCompileError(revisionOrMessage, maybeMessage, { kind = "renderer" } = {}) {
    const revision = typeof revisionOrMessage === "number" ? revisionOrMessage : null;
    const raw = typeof revisionOrMessage === "number" ? maybeMessage : revisionOrMessage;
    const text = raw instanceof Error ? raw.message : String(raw ?? "");

    /*
     * AN OLDER REVISION'S FAILURE IS NOT NEWS. The draft it was about has been
     * replaced, so the message is dropped rather than shown beside newer code.
     */
    if (revision !== null && revision < activeSourceManager().revision()) {
        return;
    }

    if (text === lastCompileError) {
        return;
    }

    lastCompileError = text;
    lastCompileErrorIsRendererFailure = kind === "renderer";

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
 * THE RESULT OF A COMPILE, ANNOUNCED ONCE.
 *
 * The Source tab's status line follows this event rather than compiling the
 * draft itself, so there is one compile per revision and one place that says
 * whether it worked.
 */
function announceRendered(revision) {
    try {
        const view = globalThis.document?.defaultView || globalThis;
        const Custom = view.CustomEvent || globalThis.CustomEvent;

        if (typeof Custom === "function" && globalThis.document) {
            globalThis.document.dispatchEvent(
                new Custom("datum:source-rendered", { detail: { revision } })
            );
        }
    } catch {
        /* Reporting must never be the thing that breaks the render. */
    }
}

/*
 * A failure that is about the CONNECTION, not about the source. The adapter
 * marks the ones it can tell apart; the message check covers an engine that
 * answers "still loading" with an ordinary error status.
 */
function isTransientFailure(error) {
    if (error && error.transient) {
        return true;
    }

    const text = error instanceof Error ? error.message : String(error ?? "");

    return /still loading|rendering is loading|could not be sent to the renderer/i.test(text);
}

/* Adopt the cached picture for `revision` as what the Drawing Space shows. */
function adoptCachedPicture(revision) {
    compiledRevision = revision;
    lastCompiledSvg = cachedPicture(revision);
    lastCompileError = null;
}

/*
 * ASK FOR A COMPILE OF THE CURRENT SOURCE.
 *
 * Idempotent per revision: a revision already cached, scheduled, compiling or
 * known to fail is not asked for again, so a redraw - which calls this on
 * every frame the current revision has no picture - can never restart the
 * debounce or abandon a compile that is running.
 *
 * `immediately` is used on load, on Undo/Redo, when Source opens and on a
 * committed gesture, where there is nothing to coalesce. The ordinary path is
 * debounced, and the debounce restarts only when the REVISION changes.
 */
export function requestSourceRender({ immediately = false } = {}) {
    const manager = activeSourceManager();
    const revision = manager.revision();

    if (cachedPicture(revision)) {
        if (compiledRevision !== revision) {
            adoptCachedPicture(revision);
            manager.markRendered(manager.getSource(), revision);
            renderCurrentDrawing();
            announceRendered(revision);
        }

        return;
    }

    if (revision === inFlightRevision || revision === failedRevision) {
        return;
    }

    if (revision === scheduledRevision && !immediately) {
        return;
    }

    if (compileTimer) {
        clearTimeout(compileTimer);
        compileTimer = null;
    }

    scheduledRevision = revision;

    /*
     * WHILE A COMPILE IS RUNNING, the next one waits for it rather than
     * queueing behind it: TeX runs one job at a time, and the running job's
     * completion schedules whatever revision is current by then.
     */
    if (inFlightRevision !== null) {
        return;
    }

    if (immediately) {
        compileCurrentSource();

        return;
    }

    compileTimer = backgroundTimer(() => {
        compileTimer = null;
        compileCurrentSource();
    }, SOURCE_RENDER_DELAY_MS);
}

/*
 * A COMPILE TIMER NEVER KEEPS A PROCESS ALIVE.
 *
 * With no reachable renderer the canvas keeps retrying - correct in a browser,
 * where the server may come up in a moment. Under Node (the test harness) that
 * pending retry was an open handle, so a test file that had finished every check
 * never exited and `npm test` hung on it. `unref` exists only on Node's timers;
 * in a browser this is an ordinary `setTimeout`.
 */
function backgroundTimer(callback, delay) {
    const timer = setTimeout(callback, delay);

    timer?.unref?.();

    return timer;
}

/*
 * After a compile finishes, the revision the student is on now - which may
 * have moved on while TeX was running - is compiled next if it still needs it.
 */
function compileWhatIsCurrent() {
    const revision = activeSourceManager().revision();

    if (cachedPicture(revision) || revision === failedRevision) {
        return;
    }

    scheduledRevision = null;
    requestSourceRender({ immediately: true });
}

async function compileCurrentSource() {
    const manager = activeSourceManager();
    const source = manager.getSource();
    const revision = manager.revision();

    scheduledRevision = null;

    /*
     * THE RENDER INPUT, NOT THE DRAFT.
     *
     * Every unfinished statement is replaced by a comment in the text handed to
     * the renderer, so a single half-typed command in an otherwise good drawing
     * does not stop the compiler at it and return nothing. The student's own
     * text is untouched; the picture is the drawing as far as it is complete.
     *
     * What is left for the validation to reject is a document that cannot be
     * rendered AT ALL - there is no picture and no commands, or the picture
     * itself is broken.
     */
    const renderText = manager.renderInput();
    const validation = validateDrawingSource(renderText);

    if (!validation.ok) {
        /*
         * A source that cannot even be parsed is not sent. The previous
         * picture stays, and the reason is reported.
         */
        failedRevision = revision;
        manager.markFailed(
            validation.diagnostics.find((entry) => entry.severity === "error")?.message || "Invalid TikZ source",
            revision
        );
        reportCompileError(
            revision,
            validation.diagnostics.find((entry) => entry.severity === "error")?.message || "Invalid TikZ source"
        );

        return false;
    }

    if (cachedPicture(revision)) {
        adoptCachedPicture(revision);
        renderCurrentDrawing();

        return true;
    }

    inFlightRevision = revision;

    const startedIn = generation;

    try {
        /*
         * THE TEXT COMPILED IS THE TEXT THE SOURCE TAB SHOWS - the marker-free
         * visible form of this revision, nothing regenerated from the model.
         */
        manager.markRendering(revision);

        const svg = await renderDrawingSource(renderText, { anchorOrigin: true });

        if (startedIn !== generation) {
            compileWhatIsCurrent();

            return false;
        }

        inFlightRevision = null;
        transientRetryMs = TRANSIENT_RETRY_MS;

        /*
         * The picture is correct FOR ITS REVISION, so it is cached whatever
         * happens next - Undo may come back to it. It is SHOWN only if that
         * revision is still the current one: an older compile finishing late
         * must never replace the output of a newer source.
         */
        rememberPicture(revision, svg);

        if (revision !== manager.revision()) {
            compileWhatIsCurrent();

            return false;
        }

        adoptCachedPicture(revision);

        manager.markRendered(source, revision);

        /*
         * A SUCCESSFUL COMPILE CLEARS ONLY A RENDERER FAILURE.
         *
         * The message that was set here was about the SOURCE not compiling at
         * all - the compiler's own complaint - and a picture that compiles is
         * the answer to it, so it goes. A DRAFT DIAGNOSTIC is a different kind
         * of message: it describes a mistake the student has not fixed yet, and
         * the picture beside it is the last good one precisely BECAUSE of that
         * mistake. Clearing it here would leave the drawing showing a picture
         * with nothing saying why it is out of date, which is the "the drawing
         * silently stopped updating" report.
         */
        if (lastCompileError && lastCompileErrorIsRendererFailure) {
            lastCompileError = null;
        }

        renderCurrentDrawing();
        announceRendered(revision);

        return true;
    } catch (error) {
        if (startedIn !== generation) {
            compileWhatIsCurrent();

            return false;
        }

        inFlightRevision = null;

        if (error && error.name === "AbortError") {
            compileWhatIsCurrent();

            return false;
        }

        if (revision !== manager.revision()) {
            /* A failure of a draft the student has already replaced. */
            compileWhatIsCurrent();

            return false;
        }

        if (isTransientFailure(error)) {
            /*
             * Nothing is wrong with the source; the renderer is not ready. The
             * same revision is tried again after a pause rather than being
             * marked broken - and rather than on every redraw.
             */
            const delay = transientRetryMs;

            transientRetryMs = Math.min(transientRetryMs * 2, TRANSIENT_RETRY_CAP_MS);
            scheduledRevision = revision;
            compileTimer = backgroundTimer(() => {
                compileTimer = null;
                compileCurrentSource();
            }, delay);

            reportCompileError(revision, error);
            manager.markFailed(error, revision, { transient: true });

            return false;
        }

        failedRevision = revision;

        /*
         * AN ENGINE FAILURE, REPORTED AS ONE. The message is the renderer's own,
         * the revision is recorded with it, and the last picture that worked
         * stays on the canvas - so a failure of the engine is never presented as
         * "every line of your source is wrong", which is what marking each
         * statement invalid would amount to.
         */
        manager.markFailed(error, revision);
        reportCompileError(revision, error);

        /*
         * The last picture that worked stays on screen. Nothing is drawn in
         * its place, because pretending a broken source rendered would be a
         * lie about the drawing.
         */
        renderCurrentDrawing();

        return false;
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
    if (compileTimer) {
        clearTimeout(compileTimer);
        compileTimer = null;
    }

    /*
     * A compile still running belongs to the document being left. Its revision
     * number may coincide with one of the new document's, so it is disowned by
     * generation rather than by revision.
     */
    generation += 1;

    compiledCache = new Map();
    modelAtRevision = new Map();
    regionsRevision = null;
    regionsMap = null;
    compiledRevision = null;
    lastCompiledSvg = null;
    lastCompileError = null;
    scheduledRevision = null;
    inFlightRevision = null;
    failedRevision = null;
    transientRetryMs = TRANSIENT_RETRY_MS;
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
    /*
     * THE PICTURE STAYS WHILE THE DRAFT IS BEING EDITED.
     *
     * It used to be dropped for a draft that failed to VALIDATE - so a source
     * being typed at, or one with a single unfinished statement, lost the whole
     * drawing until it was corrected. The drawing is the last thing that
     * compiled; a draft being edited says nothing about whether that picture is
     * still the best one to show, and blanking it is the "whole drawing
disappeared while I typed" failure.
     *
     * What this still refuses is showing ANOTHER document's picture: the cache
     * is cleared when a sheet is loaded (see `resetSourcePictureCache`), so a
     * surviving entry always belongs to this document.
     */
    const picture = cachedPicture(revision) || lastCompiledSvg;

    rememberModelAt(revision);

    const pictureRevision = cachedPicture(revision) ? revision : (picture ? compiledRevision : null);

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
        {
            overlayOnly: true,
            liveObjectIds: objectsThePictureDoesNotShow(pictureRevision, revision)
        }
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

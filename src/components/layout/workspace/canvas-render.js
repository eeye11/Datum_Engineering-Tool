/*
 * Drawing the editor's canvas.
 */

import enggDrawingState from "../../../shared/model/drawing-state.js";
import enggDrawingRenderer from "../../../shared/rendering/renderer.js";
import { SVG_NAMESPACE } from "../../../features/workspace/constants.js";
import { drawingCanvas, drawingProperties, drawingZoomValue } from "../../../features/workspace/dom.js";
import { drawingState, editorState } from "../../../features/workspace/editor-state.js";
import { renderProperties } from "../panels/feature-panel.js";
import { updateHistoryControls } from "../toolbar/tool-activation.js";

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

    enggDrawingRenderer.renderDrawing(
        drawingState,
        drawingCanvas
    );

    // Keep the inspector in sync with geometry changed by any drawing path.
    // Do not replace a field while the user is editing it.
    if (!drawingProperties.contains(document.activeElement)) {
        const selectedId = drawingState.selection.selectedObjectIds[0];
        const displayedId = drawingProperties.dataset.selectedObjectId || null;
        const current = selectedId && drawingState.objects.find(item => item.id === selectedId);
        const signature = current ? JSON.stringify({
            geometry: current.geometry,
            constraints: current.constraints,
            style: current.style
        }) : '';

        if (displayedId !== (current?.id || null) ||
            drawingProperties.dataset.geometrySignature !== signature) {
            renderProperties();
        }
    }

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

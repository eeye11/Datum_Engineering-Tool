/*
 * ========================================================
 * CAD COLOUR CONTROL - THE TOOLBAR'S OWN SWATCH
 * ========================================================
 *
 * A swatch button beside the toolbar's colour control opens THE shared picker
 * (`shared/ui/colour-picker.js`) - the same popup, palette, custom input,
 * eyedropper and recent colours that every colour field in the Features tab
 * uses. There is one picker in the application, so there is one idea of what
 * choosing a colour means.
 *
 * WHAT IS THE TOOLBAR'S OWN is only what a colour MEANS here: the value is the
 * DRAWING DEFAULT (or the selected features' stroke, when something is
 * selected), it is written through the existing style pipeline, and it is
 * published for the paint drop to show.
 *
 * The native colour input stays in the DOM as the single value source, so the
 * existing style pipeline that reads `drawingColor.value` keeps working
 * unchanged.
 */

import enggDrawingState from "../../../shared/model/drawing-state.js";
import { renderCurrentDrawing } from "../workspace/canvas-render.js";
import { drawingColor, drawingLineType, drawingThickness } from "../../../features/workspace/dom.js";
import { drawingState, editorState } from "../../../features/workspace/editor-state.js";
import { renderProperties } from "./feature-panel.js";
import { objectAtPoint } from "../../../features/workspace/interaction/hit-testing.js";
import { canvasPointFromEvent } from "../toolbar/tool-activation.js";
import { setToolMessage } from "../toolbar/toolbar-render.js";
import { syncStyleControls } from "./style-controls.js";
import {
    closeColourPopup,
    normalizeColour,
    openColourPicker,
    rememberColour
} from "../../../shared/ui/colour-picker.js";

/*
 * Apply a colour through the existing style pipeline.
 *
 * This is the toolbar's MEANING for a colour: it becomes the drawing colour the
 * style pipeline reads, it is remembered, and the swatch and the strip are
 * brought up to date.
 */
function applyColour(value) {
    const colour = normalizeColour(value);

    if (!colour) {
        return;
    }

    drawingColor.value = colour;

    rememberColour(colour);

    applyStyleControls();

    updateColourSwatch();
}

function updateColourSwatch() {
    const swatch =
        globalThis.document.getElementById(
            "drawingColourSwatch"
        );

    if (swatch) {
        /*
         * THE COLOUR IS PUBLISHED AS A TOKEN, which is what fills the droplet.
         *
         * `--datum-colour-value` is read by the toolbar's drop icon
         * (`.drawing-strip-icon-fill`), so the CURRENT DRAWING COLOUR appears
         * inside the drop.
         *
         * IT IS SET ON THE CONTROL, NOT ON THE SWATCH. The swatch is a SIBLING
         * of the icon, not an ancestor of it, so a property written there would
         * not inherit into the drop and the fill would silently fall back to the
         * surface. The wrapper contains both, so the value reaches the icon from
         * it - and the swatch still keeps its own copy, for any rule that reads
         * the swatch directly.
         *
         * IT IS THE REAL COLOUR, never the interface's green accent: the accent
         * marks which tools are ACTIVE, and a droplet filled with it would claim
         * the drawing was green.
         */
        const control =
            swatch.closest(
                ".drawing-strip-icon-control"
            ) || swatch;

        control.style.setProperty(
            "--datum-colour-value",
            drawingColor.value
        );

        swatch.setAttribute(
            "title",
            `Drawing colour: ${drawingColor.value.toUpperCase()}`
        );

        swatch.setAttribute(
            "aria-label",
            `Drawing colour: ${drawingColor.value.toUpperCase()}`
        );
    }
}

/*
 * Read a feature's own stored colour, not a sampled
 * screen pixel.
 */
export function pickColourFromFeature(
    event
) {
    const point =
        canvasPointFromEvent(
            event,
            false
        );

    const object =
        objectAtPoint(
            point
        );

    if (
        !object ||
        !object.style ||
        !normalizeColour(
            object.style.stroke
        )
    ) {
        setToolMessage(
            "No feature colour there"
        );

        return;
    }

    applyColour(
        object.style.stroke
    );

    setToolMessage(
        `Picked ${object.style.stroke}`
    );

    editorState.eyedropperActive =
        false;

    closeColourPopup();
}
/*
 * Open the shared picker against the toolbar's swatch.
 *
 * The eyedropper is offered here because there IS a drawing to sample from, and
 * it is armed on the shared editor state so the canvas' press handler can act on
 * it - the same flag the popup has always toggled.
 */
function openColourPopup(anchor) {
    openColourPicker({
        anchor,
        value: drawingColor.value,
        onChoose: (colour) => applyColour(colour),
        eyedropperActive: editorState.eyedropperActive,
        onEyedropper: (armed) => {
            editorState.eyedropperActive = armed;
            setToolMessage(
                armed
                    ? "Click a feature to pick its colour"
                    : "Select geometry"
            );
            return armed;
        }
    });
}


/*
 * Replace the plain native colour input with the swatch
 * button plus the popup, keeping the native input as the
 * value source.
 */
export function setupColourControl() {
    if (!drawingColor) {
        return;
    }

    /*
     * Already built: this function may run more than once (a second
     * install, or a dev-server re-evaluation). Rebuilding it would
     * move the input again and re-attach the listeners, so the
     * second run is a no-op.
     */
    if (
        drawingColor.classList.contains(
            "drawing-colour-native"
        )
    ) {
        return;
    }

    drawingColor.classList.add(
        "drawing-colour-native"
    );

    const control =
        globalThis.document.createElement("span");

    control.className =
        "drawing-colour-control";

    const swatch =
        globalThis.document.createElement("button");

    swatch.type = "button";
    swatch.id =
        "drawingColourSwatch";

    swatch.className =
        "drawing-colour-swatch";

    swatch.title =
        "Choose colour";

    swatch.setAttribute(
        "aria-label",
        "Choose colour"
    );

    swatch.addEventListener(
        "click",
        event => {
            event.stopPropagation();

            openColourPopup(
                swatch
            );
        }
    );

    /*
     * The swatch sits next to the existing colour label, so
     * the strip keeps its normal row layout and the native
     * input stays available as the value source.
     */
    const label =
        drawingColor.closest("label");

    /*
     * Where the control is to be placed, worked out BEFORE the
     * input is moved into it. Once drawingColor is appended to
     * control, drawingColor.parentNode IS control, so inserting
     * control next to drawingColor afterwards would be inserting
     * an element before its own child - a HierarchyRequestError
     * that leaves the toolbar half-built and stops the app from
     * starting.
     */
    const parent =
        (label && label.parentNode) ||
        drawingColor.parentNode;

    const reference =
        (label && label.nextSibling) ||
        drawingColor;

    control.appendChild(
        drawingColor
    );

    control.appendChild(
        swatch
    );

    if (parent) {
        parent.insertBefore(
            control,
            reference
        );
    }

    drawingColor.addEventListener(
        "input",
        () => {
            rememberColour(
                drawingColor.value
            );

            updateColourSwatch();
        }
    );

    updateColourSwatch();
}

/*
 * The popup closes itself on an outside press. That is the shared picker's own
 * behaviour now - the listener this used to attach here was a SECOND copy of it,
 * scoped to the toolbar's control, and it could only ever have disagreed with
 * the shared one about what counted as outside.
 */

export function applyStyleControls() {
    const nextStyle = {
        lineWidth:
            Number(
                drawingThickness.value
            ),

        stroke:
            drawingColor.value,

        lineType:
            drawingLineType.value
    };

    const selectedIds =
        drawingState.selection
            .selectedObjectIds;

    if (
        !selectedIds.length
    ) {
        drawingState.styleDefaults = {
            ...drawingState.styleDefaults,
            ...nextStyle,

            /*
             * THE STUDENT HAS CHOSEN A COLOUR, so it is now THEIR colour and not
             * the theme's default. Marking it here is what makes the choice
             * survive a later theme change - see the precedence in
             * `drawing-state.js` and the re-point in `sheet-controller.js`.
             *
             * The thickness and line type are not marked: only the COLOUR has a
             * theme-dependent default to yield to.
             */
            strokeExplicit: true
        };

        /*
         * THE ICON FOLLOWS THE DEFAULT TOO.
         *
         * With nothing selected the new style is stored as the DEFAULT for the
         * next thing drawn - and that is still a change the toolbar has to show.
         * This used to return here without re-syncing, so the thickness and
         * line-type ICONS kept the old value whenever the student changed the
         * setting with nothing selected: the control said one thing and the
         * drawing would do another.
         */
        syncStyleControls();

        return;
    }

    const previousObjects =
        enggDrawingState.snapshotDrawing(
            drawingState
        );

    drawingState.objects
        .filter(
            object =>
                selectedIds.includes(
                    object.id
                )
        )
        .forEach(
            object => {
                object.style = {
                    ...object.style,
                    ...nextStyle
                };
            }
        );

    enggDrawingState.commitDrawingChange(
        drawingState,
        previousObjects
    );

    renderProperties();
    renderCurrentDrawing();
}

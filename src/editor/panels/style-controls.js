/*
 * The toolbar's thickness, colour and line-type controls.
 *
 * THE ICONS ARE FIXED ARTWORK. They label the control; they do not redraw
 * themselves from the value. Live previews were the source of most of the
 * trouble in this row - the artwork changed size and shape as the value moved,
 * so three buttons that are IDENTICAL in markup stopped looking like a set - and
 * the value is already on the tooltip and in the dropdown, which is where it is
 * useful.
 *
 * WHAT IS STILL DYNAMIC, AND WHY IT HAS TO BE:
 *
 *   the dropdown VALUES   the selects show what the drawing actually uses
 *   the TOOLTIPS          so an icon-only control still states its setting
 *   the colour FILL       a colour swatch has to show the colour
 *
 * `syncStyleControls` is already the one place these three are written from the
 * model, so all of that happens here rather than in a second, parallel handler
 * that would be the thing to go stale.
 */

import {
    drawingColor,
    drawingLineType,
    drawingThickness
} from "../dom.js";
import { drawingState } from "../editor-state.js";

/*
 * THE LINE PATTERNS, as SVG `stroke-dasharray`.
 *
 * These are the SAME four the drawing engine supports - they are the values of
 * the select - so the icon shows a pattern the renderer actually draws, not a
 * decorative one. `null` is a solid line.
 */
const LINE_TYPE_DASHES = {
    solid: null,
    dashed: "3.5 2.5",
    center: "6 2 1.5 2",
    construction: "1.5 2.5"
};

export function syncStyleControls() {
    if (
        !drawingThickness ||
        !drawingColor ||
        !drawingLineType
    ) {
        return;
    }

    const object =
        drawingState.objects.find(
            candidate =>
                drawingState.selection
                    .selectedObjectIds
                    .includes(
                        candidate.id
                    )
        );

    const style =
        object?.style ||
        drawingState.styleDefaults;

    /*
     * The thickness control is a select with a fixed set
     * of options. A feature can hold any width (for
     * example 1.5 from the Line Width field), and
     * assigning a value that matches no option leaves the
     * control blank. Add the missing option so the
     * current value is always visible.
     */
    ensureThicknessOption(
        style.lineWidth
    );

    drawingThickness.value =
        String(
            style.lineWidth
        );

    drawingColor.value =
        style.stroke;

    drawingLineType.value =
        style.lineType;

    syncStyleLabels({
        lineWidth: style.lineWidth,
        lineType: style.lineType,
        stroke: style.stroke
    });
}

/*
 * NAME THE CONTROLS, AND FILL THE COLOUR SWATCH.
 *
 * Each control's tooltip and accessible name carry the ACTUAL CURRENT VALUE, so
 * an icon-only button still says what it is set to without a painted label:
 * "Line thickness: 0.50 mm", "Line type: Solid", "Drawing colour: #000000".
 * That is the whole trade the icon-first row makes - the words move to the
 * tooltip and to the screen reader rather than disappearing.
 */
export function syncStyleLabels({ lineWidth, lineType, stroke }) {
    const numeric = Number(lineWidth);

    const thicknessLabel = Number.isFinite(numeric)
        ? `Line thickness: ${numeric.toFixed(2)} mm`
        : "Line thickness";

    drawingThickness.setAttribute("title", thicknessLabel);
    drawingThickness.setAttribute("aria-label", thicknessLabel);

    const name = drawingLineType?.selectedOptions?.[0]?.textContent?.trim();

    const lineTypeLabel = name ? `Line type: ${name}` : "Line type";

    drawingLineType.setAttribute("title", lineTypeLabel);
    drawingLineType.setAttribute("aria-label", lineTypeLabel);

    /*
     * THE LINE-TYPE ICON SHOWS THE SELECTED PATTERN.
     *
     * Solid draws a solid rule, dashed draws dashes, centre draws a chain and
     * construction draws a fine dotted line - so the icon states WHICH line type
     * is set, not merely that this is the line-type control. The lookups are
     * keyed on the real value, and an unknown value falls back to solid rather
     * than showing a pattern the engine would not draw.
     */
    const lineTypeStroke = document.getElementById("drawingLineTypeStroke");

    if (lineTypeStroke) {
        const dashes = LINE_TYPE_DASHES[drawingLineType.value] ?? null;

        if (dashes) {
            lineTypeStroke.setAttribute("stroke-dasharray", dashes);
        } else {
            lineTypeStroke.removeAttribute("stroke-dasharray");
        }
    }

    const colourLabel = `Drawing colour: ${String(
        stroke || drawingColor.value
    ).toUpperCase()}`;

    drawingColor.setAttribute("title", colourLabel);
    drawingColor.setAttribute("aria-label", colourLabel);
}

/*
 * Make sure the thickness select can display a width,
 * adding an option for values outside the standard set.
 */
function ensureThicknessOption(
    width
) {
    if (!drawingThickness) {
        return;
    }

    const numeric =
        Number(width);

    if (!Number.isFinite(numeric) || numeric <= 0) {
        return;
    }

    const value =
        String(numeric);

    const exists =
        [...drawingThickness.options].some(
            option =>
                Number(option.value) ===
                numeric
        );

    if (exists) {
        return;
    }

    const option =
        document.createElement("option");

    option.value = value;
    option.textContent =
        `${numeric.toFixed(2)} mm`;

    drawingThickness.appendChild(
        option
    );
}

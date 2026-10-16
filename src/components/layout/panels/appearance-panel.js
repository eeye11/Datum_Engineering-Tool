/*
 * The appearance section of a feature's panel.
 */

/*
 * ========================================================
 * FEATURES THAT HAVE NO LINE, AND SO NO LINE TYPE
 * ========================================================
 *
 * A LINE TYPE DESCRIBES A STROKE, and these features are not strokes.
 *
 * A MOMENT is a curved arrow. A SUPPORT is
 * a symbol - hatching, rollers, a fixed base - assembled from several
 * short marks of different kinds. A CONNECTION is a joint. None of them is
 * drawn as one continuous line, so "Dashed" or "Centre" has no meaning to
 * apply to: offering the control promised a choice that could not change
 * what is on the sheet, and a student who picked one would reasonably
 * expect to see it happen.
 *
 * LINE WIDTH IS DIFFERENT, AND STAYS.
 *
 * Every one of these is drawn from strokes, and a heavier support symbol
 * is a real and useful thing to want - a small diagram wants a slightly
 * heavier mark at the same size. So only the Line TYPE is removed. Cutting
 * the whole APPEARANCE section would take away the one control here that
 * does something.
 *
 * THIS IS A LIST OF FEATURE TYPES, DELIBERATELY.
 *
 * It is the one place in the panel that has to know which features are
 * stroke-like, because it is the one place deciding what to OFFER rather
 * than what to compute. Everything about how a line is drawn is read from
 * the renderer's own vocabulary; nothing here can drift from what is
 * actually painted, because nothing here describes a line.
 */
const FEATURES_WITHOUT_A_LINE_TYPE = new Set([
    "moment",
    "pin-support",
    "roller-support",
    "fixed-support",
    "smooth-support",
    "pin-connection",
    "fixed-connection",
    "slider-connection"
]);

/*
 * Appearance controls shared by the property editors.
 * Real <select> and numeric inputs, so both keyboard
 * entry and the spinner arrows work.
 */
export function appearanceMarkup(
    object
) {
    /*
     * A Particle is a point body: it is drawn as a filled
     * marker, so a line type or a line width would describe
     * something that does not exist for it. It is therefore
     * the one feature that carries no APPEARANCE section,
     * rather than showing controls that cannot do anything.
     */
    if (object.type === "particle") {
        return "";
    }

    const style =
        object.style || {};

    const option = (
        value,
        label
    ) =>
        `<option value="${value}"${style.lineType === value ? " selected" : ""}>${label}</option>`;

    /*
     * Every line type the renderer knows how to draw is offered
     * here, so the panel always reflects the feature's actual
     * style.
     *
     * "Construction" was missing, which had a real consequence:
     * a feature stored as construction geometry had no matching
     * option, so no option could be marked selected and the
     * control silently displayed the first entry instead. The
     * panel then disagreed with the drawing, and changing the
     * type would have quietly replaced a real value. The list
     * is read from the same vocabulary applyStyle renders, so
     * the two stay in step.
     */

    /*
     * ONE DROPDOWN, FOR THE FEATURES THAT HAVE A LINE.
     *
     * A control that offers a choice the drawing cannot act on is not a
     * setting, so it is not offered where there is no line to style.
     */
    const lineTypeRow =
        FEATURES_WITHOUT_A_LINE_TYPE.has(
            object.type
        )
            ? ""
            : `
        <div class="drawing-property-grid drawing-property-grid-value">
            <span class="drawing-property-grid-label">Line Type</span>
            <select data-style="lineType" aria-label="Line Type">
                ${option("solid", "Solid")}
                ${option("dashed", "Dashed")}
                ${option("center", "Centre")}
                ${option("construction", "Construction")}
            </select>
            <span class="drawing-property-unit"></span>
            <span></span>
        </div>
    `;

    /*
     * THE LINE WIDTH'S UNIT, AND WHY IT IS NOT "mm".
     *
     * It used to read "mm", which claimed that a pen width is an engineering
     * length. It is not: the value goes straight to SVG stroke-width, which is
     * a SCREEN property and changes with the view. A beam 500 mm long and one
     * 5000 mm long are drawn with the same pen unless the student changes it,
     * so calling the pen "mm" invited exactly the reading the whole
     * engineering-scale system exists to prevent - that a number in this panel
     * is describing the geometry.
     *
     * "pt" is the conventional name for a line weight, and is not an
     * engineering unit, so the field reads as what it is without claiming to
     * measure the drawing.
     *
     * If this ever becomes an engineering value, the pen has to be scaled by
     * the view transform and stored apart from the geometry - not relabelled
     * here.
     */
    /*
     * A LINE WIDTH IS A NUMBER OR IT IS NOT A FIELD.
     *
     * `Number(undefined).toFixed(2)` is the string "NaN", which is how a
     * feature that never had a width set could print "NaN" in its own panel.
     * The width falls back to the renderer's own default only when the stored
     * value is genuinely absent, and the field is always a real number.
     */
    const lineWidth = Number(style.lineWidth);

    const lineWidthText = Number.isFinite(lineWidth)
        ? lineWidth.toFixed(2)
        : "0.50";

    return `
        <div class="drawing-properties-section">APPEARANCE</div>
        ${lineTypeRow}
        <div class="drawing-property-grid drawing-property-grid-value">
            <span class="drawing-property-grid-label">Line Width</span>
            <input type="number" step="0.05" min="0.05"
                data-style="lineWidth"
                aria-label="Line Width"
                value="${lineWidthText}">
            <span class="drawing-property-unit">pt</span>
            <span></span>
        </div>
    `;
}

/*
 * EDITING A DIMENSION.
 *
 * A dimension states a measurement of something else. That single fact
 * decides what this dialog may and may not offer, and getting it wrong
 * is the most serious mistake the dimension system could make.
 *
 * THE ONE THING IT WILL NOT DO
 * ----------------------------
 * It will not let the student type "50 mm" onto a line that measures
 * 100 mm and leave the geometry at 100.
 *
 * That would produce a drawing that is not merely untidy but false:
 * the geometry is unchanged, the number beside it is invented, and
 * nothing on the page says the two disagree. A checker reading the
 * drawing would see 50 mm; the geometry says 100. Everything the
 * dimension system is FOR - telling the truth about the shape - is
 * destroyed by the one edit that looks most like editing.
 *
 * So there are exactly two legitimate things to do, and the dialog
 * offers them as two clearly separate acts:
 *
 *   A. CHANGE HOW IT IS DISPLAYED
 *      Units shown or hidden, decimal places. The measurement is
 *      untouched. Safe, reversible, and the common case.
 *
 *   B. SAY THE GEOMETRY REALLY IS A DIFFERENT SIZE
 *      This is a CALIBRATION - the same one the first dimension
 *      performed. Confirming it rescales the document, and every
 *      dimension on the sheet follows, because they all read the one
 *      document scale. Nothing is distorted to fit a number.
 *
 * Both are honest. The dishonest third option simply is not present.
 *
 * The measured value is SHOWN, not offered as an input. The student can
 * see what the drawing says; what they cannot do is overwrite it.
 */
let openDialog = null;
let closeCurrent = null;

/*
 * Length units only.
 *
 * A dimension measures geometry, and geometry is length, so this
 * is the same set the calibration offers - a force or a moment
 * would not be a unit this dialog could apply.
 */
const UNITS = [
    { value: "mm", label: "Millimetres (mm)" },
    { value: "cm", label: "Centimetres (cm)" },
    { value: "m", label: "Metres (m)" },
    { value: "in", label: "Inches (in)" },
    { value: "ft", label: "Feet (ft)" }
];

function optionList(selected) {
    return UNITS.map(
        (unit) =>
            `<option value="${unit.value}"${
                    unit.value === selected ? " selected" : ""
                }>${unit.label}</option>`
    ).join("");
}

/*
 * Is this measurement an angle?
 *
 * An angle is not a length, so offering it a length unit would be
 * meaningless. Angles are shown and left alone.
 */
function isAngular(dimensionType) {
    return dimensionType === "angular";
}

function build(options) {
    const {
        dimensionType,
        measuredText,
        drawingLength,
        unit,
        precision,
        sourceName,
        angular,
        editable
    } = options;

    const dialog = document.createElement("div");

    dialog.className =
        "drawing-dimension-dialog";

    dialog.setAttribute(
        "role",
        "dialog"
    );

    dialog.setAttribute(
        "aria-modal",
        "true"
    );

    dialog.setAttribute(
        "aria-label",
        "Edit Dimension"
    );

    dialog.innerHTML = `
            <div class="drawing-dimension-dialog-title">
                Edit Dimension
            </div>

            <div class="drawing-dimension-dialog-readout">
                <div class="drawing-dimension-dialog-value">
                    ${measuredText}
                </div>
                <div class="drawing-dimension-dialog-meta">
                    ${dimensionType} &middot; ${sourceName}
                </div>
            </div>

            ${
                angular
                    ? ""
                    : `
            <fieldset class="drawing-dimension-dialog-group">
                <legend>
                    Display
                </legend>

                <label class="drawing-dimension-dialog-label"
                    for="dimPrecision">
                    Decimal places
                </label>
                <input id="dimPrecision"
                    class="drawing-dimension-dialog-input"
                    type="number" min="0" max="6" step="1"
                    value="${precision}">
            </fieldset>

            ${
                editable
                    ? `
            <fieldset class="drawing-dimension-dialog-group">
                <legend>
                    Set the size
                </legend>

                <p class="drawing-dimension-dialog-note">
                    The sheet already has a scale, so
                    this value <strong>changes the
                    geometry</strong> to match it.
                </p>

                <label class="drawing-dimension-dialog-label"
                    for="dimNewValue">
                    New length
                </label>
                <input id="dimNewValue"
                    class="drawing-dimension-dialog-input"
                    type="number" min="0" step="any"
                    inputmode="decimal"
                    placeholder="leave blank to keep">

                <label class="drawing-dimension-dialog-label"
                    for="dimNewUnit">
                    Unit
                </label>
                <select id="dimNewUnit"
                    class="drawing-dimension-dialog-select">
                    ${optionList(unit)}
                </select>
            </fieldset>
            `
                    : ""
            }

            <fieldset class="drawing-dimension-dialog-group">
                <legend>
                    Set real-world size
                </legend>

                <p class="drawing-dimension-dialog-note">
                    This measures
                    <strong>${drawingLength}</strong> in
                    the drawing. If the drawing is the
                    wrong size, set its real length here
                    &mdash; this changes the scale of the
                    whole document, not just this
                    dimension.
                </p>

                <label class="drawing-dimension-dialog-label"
                    for="dimRealValue">
                    Actual real length
                </label>
                <input id="dimRealValue"
                    class="drawing-dimension-dialog-input"
                    type="number" min="0" step="any"
                    inputmode="decimal"
                    placeholder="leave blank to keep">

                <label class="drawing-dimension-dialog-label"
                    for="dimRealUnit">
                    Unit
                </label>
                <select id="dimRealUnit"
                    class="drawing-dimension-dialog-select">
                    ${optionList(unit)}
                </select>
            </fieldset>
            `
            }

            <div class="drawing-scale-dialog-actions">
                <button type="button"
                    data-dim-cancel>Cancel</button>
                <button type="button"
                    class="primary"
                    data-dim-apply>Apply</button>
            </div>
        `;

    document.body.appendChild(
        dialog
    );

    return dialog;
}

/*
 * Open the dimension editor.
 *
 * `onApply(changes)` receives only what the student actually
 * touched:
 *
 *   { precision, calibration: { realValue, unit } }
 *
 * The calibration is absent unless a real length was entered, so
 * the caller never has to ask whether one was meant. That matters:
 * an empty field must not silently rescale a document.
 *
 * There is deliberately no show-units option. A visible dimension
 * always states its unit - a bare 500 is ambiguous with every other
 * quantity of the same size on the sheet - so whether to show it is
 * not a choice this dialog may offer.
 *
 * `onCancel` runs for every way out, including Escape.
 */
function open(options = {}) {
    close();

    const angular = isAngular(
        options.dimensionType
    );

    const dialog = build({
        dimension: options.dimension,
        dimensionType:
            options.dimensionType || "linear",
        measuredText:
            options.measuredText || "",
        drawingLength:
            options.drawingLength || "",
        unit: options.unit || "mm",
        precision: options.precision ?? 2,
        sourceName:
            options.sourceName || "unknown source",
        angular,
        editable: options.editable === true
    });

    openDialog = dialog;

    const closeIt = () => {
        close();
        options.onCancel?.();
    };

    closeCurrent = closeIt;

    /*
     * The sheet's working unit, for the resize field's default.
     *
     * Captured here because the dialog's markup is built in `build` but the
     * answer is read in `apply`, and a fallback the two disagree about would
     * be a unit silently dropped from a typed size.
     */
    const sheetUnit = options.unit || "mm";

    /*
     * =========================================================
     * A DRAFT, SO WHAT IS TYPED CAN BE SEEN BEFORE IT IS COMMITTED
     * =========================================================
     *
     * The dialog used to collect its fields and hand them over ONLY on Apply, so
     * a student editing a size saw nothing change until they confirmed - and on a
     * sheet that is not yet calibrated the number is the only evidence of what it
     * means, which made the field a guess rather than a decision.
     *
     * The SAME `changes` object is built here and reported through `onPreview` as
     * the fields are edited, so the caller can draw the proposed result. Nothing
     * is committed by previewing: `onApply` remains the ONE commit, and `onCancel`
     * - which runs for every way out, Escape included - is what takes the preview
     * back off the canvas.
     *
     * AN INVALID INTERMEDIATE VALUE IS SIMPLY NOT REPORTED. A half-typed "1" on
     * the way to "100" is a real, usable 1, so it IS reported; an empty field or a
     * non-finite one is not, and the preview keeps its previous state rather than
     * collapsing the geometry to zero.
     */
    const collectChanges = () => {
        const changes = {};

        if (!angular) {
            const precisionInput =
                dialog.querySelector(
                    "#dimPrecision"
                );

            const precision = Number(
                precisionInput.value
            );

            if (
                Number.isFinite(precision) &&
                precision >= 0 &&
                precision <= 6
            ) {
                changes.precision = precision;
            }

            /*
             * A NEW PHYSICAL SIZE, requested only when one was typed.
             *
             * This is the field that changes the GEOMETRY, and it is
             * offered only on a sheet that already has a scale - because
             * on an uncalibrated sheet there is nothing to convert
             * through, and the real-length field below is what calibrates
             * it instead.
             */
            const newValueInput =
                dialog.querySelector(
                    "#dimNewValue"
                );

            if (newValueInput) {
                const newValue = Number(
                    newValueInput.value
                );

                if (
                    newValueInput.value.trim() !== "" &&
                    Number.isFinite(newValue) &&
                    newValue > 0
                ) {
                    changes.resize = {
                        value: newValue,
                        unit:
                            dialog.querySelector(
                                "#dimNewUnit"
                            )?.value || sheetUnit
                    };
                }
            }

            /*
             * A calibration is requested ONLY when a real length
             * was actually typed. The unit alone is not enough,
             * and a blank field is not a request to rescale.
             */
            const realValue = Number(
                dialog.querySelector(
                    "#dimRealValue"
                ).value
            );

            if (
                Number.isFinite(realValue) &&
                realValue > 0
            ) {
                changes.calibration = {
                    realValue,
                    unit:
                        dialog.querySelector(
                            "#dimRealUnit"
                        ).value
                };
            }
        }

        return changes;
    };

    /*
     * THE COMMIT. It reports what the fields currently hold and closes; the
     * preview that has been showing those same values is replaced by the real
     * edit, so the drawing does not flicker between two identical states.
     */
    const apply = () => {
        const changes = collectChanges();

        close();

        options.onApply?.(changes);
    };

    /*
     * THE PREVIEW. Fired as the fields are edited, and only when the caller asked
     * for one - a dialog opened purely to read a value has nothing to preview and
     * pays nothing for this.
     */
    const preview = () => {
        if (typeof options.onPreview !== "function") {
            return;
        }

        options.onPreview(collectChanges());
    };

    dialog.querySelectorAll("input, select").forEach((control) => {
        control.addEventListener("input", preview);
        control.addEventListener("change", preview);
    });

    dialog
        .querySelector("[data-dim-apply]")
        .addEventListener(
            "click",
            apply
        );

    dialog
        .querySelector("[data-dim-cancel]")
        .addEventListener(
            "click",
            closeIt
        );

    dialog.addEventListener(
        "keydown",
        (event) => {
            if (event.key === "Enter") {
                event.preventDefault();
                apply();
            }

            if (event.key === "Escape") {
                event.preventDefault();
                closeIt();
            }
        }
    );

    const first = dialog.querySelector(
        "input, select"
    );

    first?.focus();

    return dialog;
}

function close() {
    if (openDialog) {
        openDialog.remove();
        openDialog = null;
    }

    closeCurrent = null;
}

function isOpen() {
    return openDialog !== null;
}

function handleEscape() {
    if (!openDialog) {
        return false;
    }

    closeCurrent?.();

    return true;
}

const enggDimensionEditor = {
    UNITS,
    close,
    handleEscape,
    isOpen,
    open
};

export default enggDimensionEditor;

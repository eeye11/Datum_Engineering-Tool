/*
 * SETTING THE DRAWING SCALE.
 *
 * A drawing's coordinates are numbers until somebody says how big one
 * of them is. Until then a 100-unit line could be 100 mm, 100 inches
 * or 100 parsecs, and a dimension has no honest number to print.
 *
 * Rather than print a guess with a "~" in front of it forever, the
 * FIRST dimension is what establishes the scale. That is the natural
 * moment: the student has just measured something they can put a ruler
 * against, so it is exactly when they know the answer.
 *
 * The dialog asks for two things and nothing else:
 *
 *   - the REAL distance of the geometry that was just measured
 *   - the unit that distance is in
 *
 * Both are needed. A number alone is ambiguous, and guessing the unit
 * is precisely the mistake this exists to prevent.
 *
 * WHAT THIS DELIBERATELY DOES NOT ASK
 * ----------------------------------
 * It never asks the student to restate the DRAWING length. They are
 * shown what it is; typing it back would invite a typo that silently
 * rescales the whole document. Only the side they cannot be expected
 * to know is asked for.
 *
 * WHY A MODULE AND NOT A prompt()
 * -------------------------------
 * A browser prompt cannot express two fields, cannot offer a unit
 * list, cannot say what is about to happen, and looks nothing like the
 * rest of the application. More importantly it is a modal the browser
 * owns: it cannot be styled, it steals focus wholesale, and it is easy
 * to dismiss by accident - which here would mean losing a dimension
 * without meaning to.
 *
 * The dialog is cancellable, Escape-aware, and leaves nothing behind.
 */
/*
 * The units the document's unit system already understands.
 *
 * Read from the scale module rather than restated, so adding a unit
 * there adds it here. The list is the set of units a real-world
 * LENGTH may be given in - a load or a force would not be a
 * calibration of the drawing's scale.
 */
const CALIBRATION_UNITS = [
    { value: "mm", label: "Millimetres (mm)" },
    { value: "cm", label: "Centimetres (cm)" },
    { value: "m", label: "Metres (m)" },
    { value: "in", label: "Inches (in)" },
    { value: "ft", label: "Feet (ft)" }
];

let openDialog = null;
let closeCurrent = null;

/*
 * The drawing length, shown to the student.
 *
 * Deliberately NOT an input. It is a fact about the drawing, not a
 * quantity the student is being asked to supply, and letting it be
 * edited would mean a mistyped digit silently rescales everything
 * that follows. It is stated so the real distance means something:
 * "125 mm" is only meaningful as "that 42.37".
 */
function drawingLengthText(
    measuredUnits
) {
    return (
        Number(measuredUnits).toFixed(2) +
        " drawing units"
    );
}

function build(options) {
    const measuredUnits = Number(
        options.measuredUnits
    );

    const dialog = document.createElement("div");

    dialog.className =
        "drawing-scale-dialog";

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
        "Set Drawing Scale"
    );

    const unitOptions = CALIBRATION_UNITS.map(
        (unit) =>
            `<option value="${unit.value}"${
                    unit.value === (options.unit || "mm")
                        ? " selected"
                        : ""
                }>${unit.label}</option>`
    ).join("");

    dialog.innerHTML = `
            <div class="drawing-scale-dialog-title">
                Set Drawing Scale
            </div>

            <p class="drawing-scale-dialog-text">
                The selected geometry currently measures
                <strong>${drawingLengthText(
                    measuredUnits
                )}</strong>.
                Enter its real-world size to set this
                drawing's scale.
            </p>

            <label class="drawing-scale-dialog-label"
                for="scaleRealDistance">
                Real distance
            </label>

            <input id="scaleRealDistance"
                class="drawing-scale-dialog-input"
                type="number" min="0" step="any"
                inputmode="decimal"
                value="${options.realValue ?? ""}"
                placeholder="e.g. 125">

            <label class="drawing-scale-dialog-label"
                for="scaleUnit">
                Unit
            </label>

            <select id="scaleUnit"
                class="drawing-scale-dialog-select">
                ${unitOptions}
            </select>

            <p class="drawing-scale-dialog-note">
                This scale applies to this sheet.
                Other sheets keep their own scale.
            </p>

            <div class="drawing-scale-dialog-actions">
                <button type="button"
                    data-scale-cancel>Cancel</button>
                <button type="button"
                    class="primary"
                    data-scale-confirm>Set Scale</button>
            </div>
        `;

    document.body.appendChild(
        dialog
    );

    return dialog;
}

/*
 * Open the calibration dialog.
 *
 * `onConfirm(realValue, unit)` is called only with a value that
 * could actually establish a scale. `onCancel` is called for every
 * other way out - the button, Escape, or losing the dialog - so the
 * caller has one place to put its "nothing was created" handling.
 */
function open(options = {}) {
    close();

    const measuredUnits = Number(
        options.measuredUnits
    );

    if (!Number.isFinite(measuredUnits) || measuredUnits <= 0) {
        /*
         * With nothing measured there is nothing to calibrate
         * against. Cancelling is the honest outcome - inventing a
         * scale from an unmeasurable feature would be worse than
         * asking again.
         */
        options.onCancel?.();
        return null;
    }

    const dialog = build({
        measuredUnits,
        unit: options.unit,
        realValue: options.realValue
    });

    openDialog = dialog;

    const input = dialog.querySelector(
        "#scaleRealDistance"
    );

    const select = dialog.querySelector(
        "#scaleUnit"
    );

    const closeIt = () => {
        close();
        options.onCancel?.();
    };

    closeCurrent = closeIt;

    const confirm = () => {
        const realValue =
            Number(input.value);

        const unit = select.value;

        /*
         * A non-positive or unparsable distance cannot make a
         * scale, and accepting one would produce a document whose
         * every dimension is wrong. The field is corrected and the
         * dialog stays open, so the student sees why.
         */
        if (
            !Number.isFinite(realValue) ||
            realValue <= 0
        ) {
            input.value = "";
            input.focus();
            input.select();

            dialog.querySelector(
                "[data-scale-error]"
            )?.remove();

            const note = document.createElement(
                "p"
            );

            note.className =
                "drawing-scale-dialog-error";

            note.setAttribute(
                "data-scale-error",
                ""
            );

            note.textContent =
                "Enter the real distance as a number greater than zero.";

            dialog.querySelector(
                ".drawing-scale-dialog-actions"
            ).before(note);

            return;
        }

        close();

        options.onConfirm?.(
            realValue,
            unit
        );
    };

    dialog
        .querySelector(
            "[data-scale-confirm]"
        )
        .addEventListener(
            "click",
            confirm
        );

    dialog
        .querySelector(
            "[data-scale-cancel]"
        )
        .addEventListener(
            "click",
            closeIt
        );

    input.addEventListener(
        "keydown",
        (event) => {
            if (event.key === "Enter") {
                event.preventDefault();
                confirm();
            }
        }
    );

    select.addEventListener(
        "keydown",
        (event) => {
            if (event.key === "Enter") {
                event.preventDefault();
                confirm();
            }
        }
    );

    /*
     * Escape closes without setting a scale, which is the same as
     * cancelling and must leave the document exactly as it was.
     */
    input.addEventListener(
        "keydown",
        (event) => {
            if (event.key === "Escape") {
                event.preventDefault();
                closeIt();
            }
        }
    );

    select.addEventListener(
        "keydown",
        (event) => {
            if (event.key === "Escape") {
                event.preventDefault();
                closeIt();
            }
        }
    );

    input.focus();
    input.select();

    return dialog;
}

/*
 * Close the dialog without invoking any callback.
 *
 * Used by `open` itself to clear a previous dialog, and by the
 * Escape handler in the editor when the caller wants silence rather
 * than a cancel notification.
 */
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

/*
 * Escape routed from the document level.
 *
 * The dialog handles Escape from its own inputs, but a click can
 * land elsewhere in the document, and a modal that can be stranded
 * open behind an unfocused field is a trap.
 */
function handleEscape() {
    if (!openDialog) {
        return false;
    }

    const closeIt = closeCurrent;

    closeIt?.();

    return true;
}

const enggScaleCalibration = {
    CALIBRATION_UNITS,
    close,
    handleEscape,
    isOpen,
    open
};

export default enggScaleCalibration;

/*
 * ============================================================
 * THE LOAD MAGNITUDE POPUP
 * ============================================================
 *
 * A Distributed Load's magnitude is a physical quantity - a force per unit
 * length - and asking for it is the same kind of question the creation
 * popup asks for a length: one number, with the unit it is stated in.
 *
 * So this is a SMALL, SELF-CONTAINED POPUP that offers the LOAD units -
 * kN/m and N/mm - rather than length units. (Its styling classes are named
 * for the retired creation-size popup that first used them.)
 *
 * WHAT IT COLLECTS, AND WHAT IT DOES NOT
 * --------------------------------------
 * It collects a NUMBER AND A UNIT and hands them back:
 *
 *     { value: 5, unit: "kN/m" }
 *
 * It performs NO conversion. kN/m and N/mm are the same physical quantity -
 * one kilonewton per metre is one newton per millimetre - so the number the
 * student types is the number that is stored, and the unit travels beside
 * it. Whoever called this decides what the quantity means; this module is
 * only a question about input.
 *
 * THE STUDENT MAY TYPE THE UNIT. "5 kN/m" is read as 5 in kN/m and switches
 * the control to match, so the box never shows one unit while the value was
 * entered in another.
 */
import enggQuantities from "../../units/quantities.js";
import enggLoadProfile from "../../../features/workspace/model/analysis/load-profile.js";

/*
 * The dialog element currently on screen, and the way to close it from the
 * outside. One at a time: opening a second closes the first, so a load
 * being built point by point cannot stack popups behind one another.
 */
let openPopup = null;

export function closeLoadValuePopup() {
    if (!openPopup) {
        return;
    }

    const closing = openPopup;

    openPopup = null;

    closing.remove();
}

/*
 * How a value is written into the field: no exponent notation, no forced
 * decimals, and trailing zeros trimmed by the number itself. The same rule
 * the drawing uses, so a suggested magnitude reads here as it does on the
 * sheet.
 */
function formatValue(value) {
    const numeric = Number(value);

    if (!Number.isFinite(numeric)) {
        return "";
    }

    return String(Number(numeric.toFixed(6)));
}

function unitOptions(selected, units) {
    const list =
        Array.isArray(units) && units.length
            ? units
            : enggLoadProfile?.LOAD_UNITS || ["kN/m", "N/mm"];

    return list
        .map(
            unit =>
                `<option value="${unit}"${
                    unit === selected ? " selected" : ""
                }>${unit}</option>`
        )
        .join("");
}

export function openLoadValuePopup({
    title = "Distributed Load",
    label = "Magnitude",
    value = "",
    unit = enggLoadProfile?.DEFAULT_LOAD_UNIT || "kN/m",

    /*
     * WHICH UNITS THIS POPUP OFFERS.
     *
     * A load is stated in kN/m or N/mm; a force is stated in N. The popup is
     * the same one either way - it is a number and a unit - but the unit list
     * belongs to the QUANTITY, so it is passed in. Without this a force would
     * have been offered load units, which is a category error the student
     * would see immediately.
     */
    units,
    onOpen,
    onConfirm,
    onPreview,
    onCancel,

    /*
     * WHETHER A NON-NUMERIC ANSWER IS ACCEPTED.
     *
     * Off by default, so every existing caller - a load magnitude, a force -
     * behaves exactly as it does today: a number is required and words are
     * refused. That is the whole compatibility story, and it is why this is a
     * flag rather than a change to the reading.
     *
     * ON for a Variable Dimension, whose answer is a SYMBOL or an expression
     * rather than a measurement: `θ`, `L/2`, `3*x + 5`. There is nothing to
     * evaluate and nothing to convert - the text IS the value - so a
     * non-numeric answer is returned verbatim as `{ text }` instead of being
     * read as a number.
     */
    expression = false,

    /*
     * WHETHER AN EMPTY FIELD MAY BE CONFIRMED.
     *
     * Off by default, so every existing caller keeps its behaviour: an empty
     * box is UNKNOWN, which is a real answer for a force or a load magnitude.
     *
     * ON for a Variable Dimension being CREATED, where the requirement is
     * explicit - a new Variable Dimension must always carry content and a blank
     * one must never be committed. An empty box is refused with a message and
     * the editor STAYS OPEN so the student can correct it, rather than closing
     * and leaving nothing behind with no explanation.
     */
    requireContent = false
} = {}) {
    closeLoadValuePopup();

    const popup = document.createElement("div");

    popup.className = "drawing-creation-dimension";

    popup.setAttribute("role", "dialog");
    popup.setAttribute("aria-label", title);

    const allowedUnits =
        Array.isArray(units) && units.length
            ? units
            : enggLoadProfile?.LOAD_UNITS || ["kN/m", "N/mm"];

    const initialUnit = allowedUnits.includes(unit)
        ? unit
        : allowedUnits[0];

    const chosen = {
        unit: initialUnit
    };

    popup.innerHTML = `
            <div class="drawing-creation-dimension-title">${title}</div>
            <div class="drawing-creation-dimension-body">
                <span class="drawing-creation-dimension-label"
                    data-load-label>${label}</span>
                <span class="drawing-creation-dimension-input-wrap">
                    <input type="text"
                        class="drawing-creation-dimension-input"
                        data-load-input
                        inputmode="${expression ? "text" : "decimal"}"
                        autocomplete="off"
                        aria-label="${label}">
                    ${
                        /*
                         * NO UNIT CONTROL IN EXPRESSION MODE. A symbol is not
                         * a quantity with a unit - `L` is not "L mm" until the
                         * student says so - so offering a unit would invite them
                         * to attach one to their own algebra.
                         */
                        expression
                            ? ""
                            : `<select
                        class="drawing-creation-dimension-unit"
                        data-load-unit
                        aria-label="Unit">
                        ${unitOptions(chosen.unit, allowedUnits)}
                    </select>`
                    }
                </span>
            </div>
            <div class="drawing-creation-dimension-error"
                data-load-error hidden></div>
        `;

    document.body.appendChild(popup);

    const input = popup.querySelector("[data-load-input]");
    const select = popup.querySelector("[data-load-unit]");
    const errorEl = popup.querySelector("[data-load-error]");

    input.value = value === null || value === undefined
        ? ""
        : formatValue(value);

    openPopup = popup;

    /*
     * THE FIELD OPENS FOCUSED AND SELECTED, so a student who accepts the
     * suggestion can press Enter at once, and one who wants a different
     * number just types over the top of it.
     */
    input.focus();
    input.select();

    /*
     * TELL THE CALLER THE POPUP IS OPEN, so it can report the current step in
     * the ONE place instructions live - the bottom bar. The popup itself never
     * prints instructions into the Features tab.
     */
    if (typeof onOpen === "function") {
        onOpen();
    }

    const reportPreview = () => {
        if (typeof onPreview !== "function") {
            return;
        }

        const text = input.value.trim();

        /*
         * IN EXPRESSION MODE the preview is the TEXT, not a number: there is
         * nothing to evaluate, and a caller previewing a variable wants the
         * symbol it is about to draw.
         */
        if (expression) {
            onPreview({ text });

            return;
        }

        const read = enggLoadProfile.readLoadValue(
            text,
            select.value
        );

        onPreview(read);
    };

    const confirm = () => {
        const text = input.value.trim();

        /*
         * AN EMPTY FIELD IS AN ANSWER, NOT A MISTAKE.
         *
         * It means UNKNOWN - "I have not worked this out yet" - which is a
         * real state on a student's sheet and one the Features panel already
         * speaks. Refusing it, as this used to, made the panel's Unknown mark
         * unreachable from the one place the value is entered.
         *
         * So an empty box is CONFIRMED, and the caller is handed `text: ""`
         * to read through `readStaticsValue`, which answers Unknown.
         */
        if (!text) {
            /*
             * MANDATORY CONTENT: AN EMPTY BOX IS REFUSED, NOT CONFIRMED.
             *
             * The editor is kept OPEN so the answer can be corrected - the
             * alternative, closing on an empty field, is what used to create a
             * blank feature the student never asked for.
             */
            if (requireContent) {
                errorEl.textContent = "Enter a value, expression or text";
                errorEl.hidden = false;

                input.focus();

                return;
            }

            errorEl.hidden = true;

            const confirmed = { text: "", unknown: true };

            if (openPopup === popup) {
                openPopup = null;
            }

            popup.remove();

            if (typeof onConfirm === "function") {
                onConfirm(confirmed);
            }

            return;
        }

        /*
         * A SYMBOL OR AN EXPRESSION IS THE ANSWER ITSELF.
         *
         * `θ`, `L/2` and `3*x + 5` are not measurements to be read - they are
         * what the student wrote, and the text IS the value. It is handed back
         * VERBATIM, so nothing rewrites `L/2` into `2` on the way through.
         *
         * A plain number still goes down the numeric path, so a Variable
         * Dimension can carry `25` as readily as `L` - and the unit control is
         * absent, so there is no unit to read.
         */
        if (expression) {
            errorEl.hidden = true;

            const confirmed = { text };

            if (openPopup === popup) {
                openPopup = null;
            }

            popup.remove();

            if (typeof onConfirm === "function") {
                onConfirm(confirmed);
            }

            return;
        }

        /*
         * A STATICS QUANTITY: A NUMBER, A SYMBOL, OR NOTHING.
         *
         * `readStaticsValue` is the ONE reader of a typed answer, so `F₁`
         * means the same here as it does in every other Statics tool. A
         * non-numeric entry is NOT an error - it is the student's own symbol -
         * so it is handed back as text rather than refused, which is what the
         * old `readLoadValue`-or-error path did.
         *
         * THE NUMERIC PATH IS UNCHANGED for a plain number: the unit is read
         * from the control exactly as before.
         */
        const answer = readStaticsValue(text, select?.value);

        if (answer.kind === "number") {
            /*
             * THE STUDENT'S OWN UNIT, if the field named one. Typing an
             * explicit unit is the most specific answer available, so it wins
             * over the control - and the control is moved to match, so the two
             * never disagree about what was entered.
             */
            chosen.unit = answer.unit || chosen.unit;

            if (select) {
                select.value = chosen.unit;
            }

            errorEl.hidden = true;

            const confirmed = {
                value: answer.value,
                unit: chosen.unit,
                text,
            };

            if (openPopup === popup) {
                openPopup = null;
            }

            popup.remove();

            if (typeof onConfirm === "function") {
                onConfirm(confirmed);
            }

            return;
        }

        /*
         * A SYMBOL IS CONFIRMED AS TEXT, and the unit control is left alone
         * because a symbol has no unit to state.
         */
        errorEl.hidden = true;

        const confirmed = { text, symbol: true, unit: select?.value || null };

        if (openPopup === popup) {
            openPopup = null;
        }

        popup.remove();

        if (typeof onConfirm === "function") {
            onConfirm(confirmed);
        }
    };

    const cancel = () => {
        if (openPopup === popup) {
            openPopup = null;
        }

        popup.remove();

        if (typeof onCancel === "function") {
            onCancel();
        }
    };

    /*
     * THE UNIT CONTROL MOVES THE NUMBER WITH IT.
     *
     * kN/m and N/mm are numerically identical, so switching the control
     * does not have to convert anything - but the field is left as typed,
     * and the newly chosen unit is what it will be read in. The preview is
     * re-reported so what is shown follows the choice.
     *
     * THERE IS NO CONTROL IN EXPRESSION MODE, so this is bound only when one
     * was rendered.
     */
    select?.addEventListener("change", () => {
        chosen.unit = select.value;

        reportPreview();
    });

    input.addEventListener("input", () => {
        errorEl.hidden = true;
        reportPreview();
    });

    input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            /*
             * THE ENTER BELONGS TO THIS POPUP, AND MUST NOT REACH THE
             * CANVAS.
             *
             * The application finishes whatever is being built when Enter is
             * pressed - a truss, a polyline, a varying load. A load's
             * magnitude popup is open WHILE that load is being built, so an
             * Enter that reached the canvas would confirm the value and, in
             * the same keystroke, finish the whole load - committing it after
             * the very first point. The event is therefore stopped here, so
             * the popup's own Enter means "use this value" and nothing else.
             */
            event.preventDefault();
            event.stopPropagation();
            confirm();
            return;
        }

        if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            cancel();
        }
    });

    /*
     * ENTER CONFIRMS, WHICHEVER CONTROL HAS FOCUS.
     *
     * The student's rhythm is "type the number, pick the unit, press Enter",
     * so the Enter arrives while the UNIT SELECT has focus - not the text
     * field. Listening on the popup (which sees every keydown inside it, from
     * any control) means the confirmation is the same whichever control was
     * last touched, and an Apply-button click is never required.
     *
     * Escape anywhere closes it. Neither key is allowed to reach the canvas: a
     * load's popup is open WHILE that load is being built, and the canvas
     * treats Enter as "finish what I am making" - which would commit the load
     * on the same keystroke that accepted its first value.
     */
    popup.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            event.preventDefault();
            event.stopPropagation();
            confirm();
            return;
        }

        if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            cancel();
        }
    });

    document.addEventListener(
        "pointerdown",
        function onOutside(event) {
            if (!popup.isConnected) {
                document.removeEventListener(
                    "pointerdown",
                    onOutside
                );
                return;
            }

            if (!popup.contains(event.target)) {
                document.removeEventListener(
                    "pointerdown",
                    onOutside
                );

                cancel();
            }
        },
        true
    );

    return popup;
}

/*
 * ============================================================
 * WHAT A TYPED ANSWER MEANS
 * ============================================================
 *
 * Every Statics tool that asks for a value after placement asks the SAME
 * question through the same popup, so the answer must mean the same thing
 * everywhere. This is the ONE reader of that answer, and it recognises the
 * three states the model already has:
 *
 *   a NUMBER     -> a numeric magnitude, exactly as typed
 *   EMPTY        -> UNKNOWN (`unknownValues[magnitudeKey]`), which the Features
 *                   panel already prints as an unknown quantity
 *   ANYTHING ELSE-> the student's own SYMBOL or expression, kept verbatim as
 *                   the feature's magnitude LABEL
 *
 * WHY THIS EXISTS AT ALL.
 *
 * The callers each used to do `Math.max(0, Number(value) || 0)`, which turns
 * `F₁` and an empty box alike into ZERO. Zero is a measurement - "this force is
 * nothing" - and neither of those answers says that. A student who typed a
 * symbol was silently given a different statement from the one they made.
 *
 * NOTHING HERE EVALUATES AN EXPRESSION. `2*M` is not 2 times anything until the
 * student's own algebra defines M; it is what they wrote, and it is what the
 * sheet prints.
 *
 * `unit` is returned for a numeric answer only. A symbol has no unit until the
 * student gives it one, so attaching `kN` to `F₁` would be a claim they did not
 * make.
 */
export function readStaticsValue(text, unit) {
    const raw = String(text ?? "").trim();

    /*
     * EMPTY IS UNKNOWN, NOT ZERO.
     *
     * "I have not worked this out yet" is a real and common state on a student's
     * sheet - it is what the `?` toggle in the Features panel means too - so an
     * empty box is read as that same statement rather than as a value.
     */
    if (!raw) {
        return { kind: "unknown" };
    }

    /*
     * A UNIT TYPED IN THE FIELD WINS OVER THE CONTROL.
     *
     * "5 kN/m" is the most specific answer available - the student named both
     * the number and what it is in - so it is read as a number in THAT unit and
     * the control is moved to match, which is what the popup has always done.
     * The known units are tried longest-first so `kN·m` is not read as `kN`.
     */
    const byUnit = readNumberWithUnit(raw, unit);

    if (byUnit) {
        return byUnit;
    }

    /*
     * A PLAIN NUMBER, with an optional sign and decimals. Comma-grouped and
     * exponent forms are deliberately NOT accepted as numeric: "1,000" and
     * "1e3" are rare enough here that reading them as symbols is safer than
     * guessing at the student's intent.
     */
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(raw)) {
        const value = Number(raw);

        if (Number.isFinite(value)) {
            return { kind: "number", value, unit: unit || null };
        }
    }

    /*
     * EVERYTHING ELSE IS THE STUDENT'S OWN SYMBOL, kept exactly as typed -
     * `F₁`, `M`, `w`, `θ`, `2*M`, `(L+W)/2`. The text IS the value.
     */
    return { kind: "symbol", text: raw };
}

/*
 * "5 kN/m" read as a number in that unit, or null when it is not that shape.
 *
 * The unit is matched against the units the POPUP was given, so the same text
 * can never be read as a unit this quantity does not use. A trailing unit is
 * optional, so "5" also arrives here and is handed to the plain-number path
 * below - one reader, two shapes.
 *
 * THE CANDIDATES COME FROM THE SHARED QUANTITY TABLES, across every family
 * the popups serve - length, force, moment, distributed load, angle - rather
 * than a second hand-typed list. The second list was exactly the drift the
 * shared tables exist to prevent: it spelled a moment's imperial unit
 * "lb·ft" where the table spells it "lbf·ft", so the one answer the student
 * typed the table's way was refused. Reading the tables means the popups and
 * the Features panel accept the same spellings, always.
 *
 * Longest first, so `kN·m` is not read as `kN` and `N/mm` as `N`.
 */
function readNumberWithUnit(raw, unit) {
    const known = [
        ...(
            enggQuantities?.unitsFor?.("length") || ["mm", "cm", "m"]
        ),
        ...(
            enggQuantities?.unitsFor?.("force") || ["N", "kN"]
        ),
        ...(
            enggQuantities?.unitsFor?.("moment") || ["N·m", "kN·m"]
        ),
        ...(
            enggQuantities?.unitsFor?.("distributedLoad") || ["kN/m", "N/mm"]
        ),
        ...(
            enggQuantities?.unitsFor?.("angle") || ["°", "rad"]
        ),
    ];

    /* Longest first, so `kN·m` is not read as `kN`. */
    const candidates = [...new Set(known)].sort((a, b) => b.length - a.length);

    for (const candidate of candidates) {
        if (!raw.toLowerCase().endsWith(candidate.toLowerCase())) {
            continue;
        }

        const numberText = raw
            .slice(0, raw.length - candidate.length)
            .trim();

        if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(numberText)) {
            continue;
        }

        const value = Number(numberText);

        if (Number.isFinite(value)) {
            return { kind: "number", value, unit: candidate };
        }
    }

    void unit;

    return null;
}

/*
 * ============================================================
 * APPLYING THAT ANSWER TO A FEATURE
 * ============================================================
 *
 * The three states live on the feature in three places that already exist:
 * `geometry[valueKey]` for the number, `unknownValues[valueKey]` for Unknown,
 * and `magnitudeLabel` for the symbol. This writes all three consistently, so
 * a learner does not have to know which one their answer landed in.
 *
 * IT CLEARS THE OTHER TWO. A force that was `F₁` and is now `250 N` must stop
 * saying `F₁`, and one that was 250 and is now Unknown must not keep the 250
 * underneath the `?`. Setting one state without clearing the others is exactly
 * how a panel ends up showing a number beside an "Unknown" mark.
 */
export function applyStaticsValue(object, answer, options = {}) {
    if (!object) {
        return null;
    }

    const valueKey = options.valueKey || "magnitude";
    const geometry = object.geometry || (object.geometry = {});

    object.unknownValues = object.unknownValues || {};

    if (answer?.kind === "number") {
        geometry[valueKey] = answer.value;
        object.unknownValues[valueKey] = false;
        object.magnitudeLabel = null;

        return answer.value;
    }

    if (answer?.kind === "symbol") {
        object.magnitudeLabel = answer.text;
        object.unknownValues[valueKey] = false;

        /*
         * THE NUMBER IS CLEARED, not kept beside the symbol. A force labelled
         * `F₁` has no number the drawing can state, and leaving the previous
         * one in place would make the annotation and the panel disagree.
         */
        delete geometry[valueKey];

        return null;
    }

    /* UNKNOWN: no number, and the `?` mark on. */
    delete geometry[valueKey];
    object.unknownValues[valueKey] = true;
    object.magnitudeLabel = null;

    return null;
}

/*
 * ============================================================
 * CREATION-TIME DIMENSION INPUT
 * ============================================================
 *
 * When a student draws something that has a physical size, the
 * natural moment to say how big it is has just passed: the
 * geometry is on the screen, the shape is settled, and the one
 * thing still unknown is what the number means.
 *
 * This module is the INPUT for that moment. It is one compact
 * inline popup, not a modal dialog and not a settings page, that
 * asks for one engineering quantity and then - for a shape that
 * genuinely has two - a second one. Enter commits the current
 * field; for a two-value shape Enter on the first advances to
 * the second. Escape abandons the whole thing.
 *
 * WHAT IT DELIBERATELY IS NOT
 * ---------------------------
 * It is NOT a second scale system. It knows nothing about world
 * units, calibration or conversion. It collects a NUMBER AND A
 * UNIT from the student and hands the structured quantity back.
 * Whoever called it decides what that quantity means - because that
 * is a question about geometry, and this module is only a question
 * about input.
 *
 * THE UNIT IS PART OF THE ANSWER, NOT PART OF THE DECORATION
 * ----------------------------------------------------------
 * The student is TYPING a physical length, so the number they type
 * only means something once they say what unit it is in. "500" is
 * half a metre, five metres or half a millimetre, and the drawing
 * has no way to guess which was meant. So the unit is a control
 * they can change, and the pair - value plus unit - is the answer
 * that is handed back:
 *
 *     [{ value: 0.5, unit: "m" }, ...]
 *
 * That is why this is a SELECT and not a printed label. A label
 * would tell the student what unit their number is being read as
 * and offer them no say in it, which is precisely the mistake this
 * design avoids: entering 500 while the box said mm is not a
 * millimetre beam because the box said so.
 *
 * IT IS STILL NOT THE ANNOTATION UNIT DISPLAY
 * --------------------------------------------
 * Whether a force is annotated "100 N" or just "100" is a
 * per-feature display setting, decided somewhere else entirely and
 * applied to the drawing. It has nothing to do with which unit the
 * student is typing a length in, and the two never meet: this
 * control exists only while a creation popup is open, and it
 * disappears with the popup.
 *
 * THE VALUE THE FIELD STARTS WITH IS A SUGGESTION
 * -----------------------------------------------
 * computed by the caller and expressed in the unit the field is
 * currently set to. It is shown in exactly the same style as a
 * typed value and it never carries a "~": a suggestion is a real
 * engineering quantity the student can accept by pressing Enter,
 * and marking it as approximate would say the document does not
 * know what the number is - which is the opposite of true.
 *
 * WHY IT IS SEPARATE FROM scale-calibration.js
 * --------------------------------------------
 * The scale dialog asks a different question ("what is this
 * thing really?") in a different place (a modal, because the
 * document has no scale yet and nothing else can proceed). This
 * asks "how big is the thing I just made?" inline, while the
 * student is still looking at it, and its answer is usually a
 * property of the new feature rather than of the document. They
 * share the unit list and the quantity formatter and nothing
 * else, which is the right amount of sharing.
 */
import enggQuantities from "../../../../shared/units/quantities.js";

/*
 * The units a length may be GIVEN in, read from the one length
 * definition the document already has rather than restated here.
 * Adding a unit to quantities.js adds it to this popup, and to
 * every other reader of the same list.
 *
 * These are the choices offered, not the unit in force: the
 * document decides what the field starts on, and the student may
 * pick any of them before committing.
 */
function lengthUnits() {
  const quantities = enggQuantities;

  const units = quantities?.LENGTH_UNITS || { mm: { label: "mm" } };

  return Object.keys(units).map((value) => ({
    value,
    label: units[value]?.label || value
  }));
}

/*
 * The unit a field should open on.
 *
 * A field's own suggestion carries the unit it was suggested in,
 * so that suggestion and unit always agree. Falling back to the
 * document's unit - and then to millimetres - means the control
 * is never empty or meaningless.
 */
function unitForField(field, fallback) {
  if (field?.unit && enggQuantities?.LENGTH_UNITS?.[field.unit]) {
    return field.unit;
  }

  if (fallback && enggQuantities?.LENGTH_UNITS?.[fallback]) {
    return fallback;
  }

  return (
    enggQuantities?.DEFAULT_LENGTH_UNIT || "mm"
  );
}

/*
 * Re-express a suggested value in a newly chosen unit.
 *
 * When the student switches from mm to m, a field showing "500"
 * must not keep showing 500 - that would silently multiply the
 * member by a thousand the moment they pressed Enter. So the
 * number is converted, and the SAME number keeps meaning the
 * SAME physical length across the switch.
 *
 * A field with no suggestion has nothing to convert, so changing
 * the unit simply leaves it empty.
 */
function convertSuggestion(value, fromUnit, toUnit) {
  const units = enggQuantities?.LENGTH_UNITS;

  const numeric = Number(value);

  if (
    !units ||
    !Number.isFinite(numeric) ||
    !units[fromUnit] ||
    !units[toUnit] ||
    fromUnit === toUnit
  ) {
    return value;
  }

  const millimetres = numeric * units[fromUnit].mm;

  return millimetres / units[toUnit].mm;
}

/*
 * How a quantity is written into the field.
 *
 * The number is the authoritative value in the unit beside it, and
 * it is trimmed of trailing zeros through the SHARED formatter, so
 * a converted suggestion reads the way every other readout in the
 * application does. The formatter is given no unit: the unit is a
 * separate control in the same box, and appending one here would
 * print "0.5 m" into a field whose select already says "m".
 */
function formatValue(value) {
  const quantities = enggQuantities;

  if (!Number.isFinite(Number(value))) {
    return "";
  }

  return quantities?.number
    ? quantities.number(value)
    : String(value);
}

let openPopup = null;
let closeCurrent = null;

/*
 * THE OPEN POPUP'S POINTER LISTENER.
 *
 * Held so `close()` can take it off the document again - see the note where it
 * is registered. One popup can be open at a time, so one reference is enough.
 */
let pointerListener = null;

/*
 * AND THE OPEN POPUP'S ESCAPE LISTENER, held for the same reason.
 *
 * Escape is caught on the DOCUMENT so it works whether or not anything inside
 * the popup has focus; a listener on the document outlives the popup unless it
 * is removed, so `close()` takes this one off by the same reference the pointer
 * listener uses.
 */
let escapeListener = null;

/*
 * A confirmation that has just happened, and whether the keyboard
 * event that caused it has finished travelling.
 *
 * WHY THIS IS NEEDED
 * ------------------
 * Confirming removes the popup from the document BEFORE running
 * the caller's callback. That is deliberate - it means the canvas
 * is clear while the geometry is committed, and that a callback
 * which throws cannot leave an orphaned input behind.
 *
 * But it has a consequence the popup cannot fix on its own. The
 * keydown that confirmed the value is still bubbling when that
 * removal happens, and by the time it reaches the document handler
 * the field it was typed in no longer exists. Anything that decides
 * "is the user typing?" by asking about the focused element now
 * gets the wrong answer, and a canvas shortcut that means
 * something else entirely can fire on the very keystroke that set
 * the feature's size.
 *
 * So the popup stops the key from travelling any further: the
 * keydown handlers on the input call `stopPropagation`, which is
 * what every dialog in the application already does with the keys
 * it owns. A dialog that does not stop a key is a dialog that
 * leaks its keystrokes to the canvas behind it.
 *
 * There is deliberately no "recently consumed" flag here. One was
 * tried and removed: it has to be cleared at some point, and every
 * way of choosing that point is a race - clear it early and the
 * canvas shortcut fires on the confirming Enter, clear it late and
 * it swallows the next, unrelated key and stops the next tool from
 * being chosen. Stopping the event is exact: it lasts precisely as
 * long as the event does, and not one millisecond longer.
 */

/*
 * Build the popup for a list of fields.
 *
 * `fields` is the whole of what is asked, in order:
 *
 *   [{ label, value, unit, min, allowZero }, ...]
 *
 * A one-field shape passes one entry; a rectangle passes two.
 * The popup shows them one at a time, so the student is never
 * looking at a form - just the next number the shape needs.
 */
function build(options, fields) {
  const popup = document.createElement("div");

  popup.className = "drawing-creation-dimension";

  popup.setAttribute("role", "dialog");
  popup.setAttribute("aria-label", options.title || "Dimension");

  const unitLabel = unitForField(
    fields[0],
    options.unit
  );

  /*
   * The heading names the thing being sized, so a popup over a
   * rectangle says "Rectangle" and not "Length" - which is the
   * difference between being asked about the object and being
   * asked about a number.
   */
  const title = options.title || "Size";

  /*
   * The unit is a SELECT, not a label. Every length unit the
   * document understands is offered, the field's own suggested
   * unit is selected, and the control is built from the shared
   * unit list rather than hard-coding mm/cm/m - so a unit added
   * to quantities.js appears here without this file being touched.
   */
  const unitOptions = lengthUnits()
    .map(
      unit => `
            <option
                value="${unit.value}"
                ${unit.value === unitLabel ? "selected" : ""}
            >${unit.label}</option>
        `
    )
    .join("");

  popup.innerHTML = `
            <div class="drawing-creation-dimension-title">${title}</div>
            <div class="drawing-creation-dimension-body">
                <span class="drawing-creation-dimension-label"
                    data-creation-label>${fields[0]?.label || "Length"}</span>
                <span class="drawing-creation-dimension-input-wrap">
                    <input type="text"
                        class="drawing-creation-dimension-input"
                        data-creation-input
                        inputmode="decimal"
                        autocomplete="off"
                        aria-label="${fields[0]?.label || "Length"}">
                    <select
                        class="drawing-creation-dimension-unit"
                        data-creation-unit
                        aria-label="Unit">
                        ${unitOptions}
                    </select>
                </span>
            </div>
            <div class="drawing-creation-dimension-step"
                data-creation-step></div>
            <div class="drawing-creation-dimension-error"
                data-creation-error hidden></div>
        `;

  document.body.appendChild(popup);

  return popup;
}

/*
 * Open the popup and collect the quantities.
 *
 * `onConfirm(values)` receives the structured quantities in the
 * order they were asked for:
 *
 *     [{ value: 0.5, unit: "m" }, ...]
 *
 * The `unit` is the one the student had CHOSEN on that field, not
 * a label the document imposed on them. The caller is responsible
 * for converting it, which it does through the same scale every
 * other length in the application goes through.
 *
 * `onCancel` is called for every way out that is not a
 * confirmation - the Escape key, or losing the popup - so the
 * caller has one place to put its "nothing was created"
 * handling. A value is only ever reported after it has been
 * validated, so a caller can trust that `onConfirm` means the
 * geometry can be committed.
 */
function open(options = {}) {
  close();

  const fields = (options.fields || []).filter(Boolean);

  if (!fields.length) {
    options.onCancel?.();
    return null;
  }

  const popup = build(options, fields);

  openPopup = popup;

  const input = popup.querySelector("[data-creation-input]");
  const label = popup.querySelector("[data-creation-label]");
  const unitEl = popup.querySelector("[data-creation-unit]");
  const stepEl = popup.querySelector("[data-creation-step]");
  const errorEl = popup.querySelector("[data-creation-error]");

  let index = 0;

  /*
   * The values confirmed so far, as structured quantities. Kept
   * separate from the field list so a re-render never loses what
   * was already accepted.
   */
  const collected = [];

  /*
   * The unit chosen on the field currently being answered.
   *
   * It is held HERE rather than read back off the select each time,
   * because the select is the student's control and the two must
   * never disagree: what is reported is exactly what is shown.
   */
  const chosen = { unit: unitForField(fields[0], options.unit) };

  /*
   * Set once the student types, cleared each time a field is
   * rendered. A field showing its own suggestion is converted when
   * the unit changes; a typed one is left as the student wrote it.
   */
  let touched = false;

  const closeIt = () => {
    close();
    options.onCancel?.();
  };

  closeCurrent = closeIt;

  const showError = (message) => {
    errorEl.textContent = message;
    errorEl.hidden = false;
  };

  const clearError = () => {
    errorEl.textContent = "";
    errorEl.hidden = true;
  };

  const renderStep = () => {
    const field = fields[index];

    label.textContent = field.label || "Length";
    input.setAttribute("aria-label", field.label || "Length");

    /*
     * Each field opens on the unit its own suggestion was made in,
     * so a suggestion and the unit beside it can never disagree.
     */
    chosen.unit = unitForField(field, options.unit);
    unitEl.value = chosen.unit;

    input.value = formatValue(field.value);

    /*
     * Whether the student has typed into THIS field. A field that
     * still holds the suggestion is ours to convert when the unit
     * changes; one they have edited is theirs, and is left alone.
     */
    touched = false;

    /*
     * The step indicator is only shown when there is more than
     * one field, and it says where the student is so a
     * two-value shape is never mistaken for a one-value one.
     */
    stepEl.textContent =
      fields.length > 1 ? `${index + 1} of ${fields.length}` : "";

    input.focus();
    input.select();

    /*
     * Show the feature straight away, at its suggested size, before
     * the student has touched anything. The drawing has been on
     * screen since the last click; the popup must not be the thing
     * that makes it disappear.
     */
    notifyPreview();
  };

  input.addEventListener("input", () => {
    touched = true;

    /*
     * THE DRAWING FOLLOWS THE NUMBER.
     *
     * The student is being asked how big something is, with that
     * something in front of them. If the value they type does not
     * change what is drawn, the question is being asked against
     * nothing - and on a sheet that is not yet calibrated it is the
     * ONLY evidence of what the number means, because no other
     * length on the sheet shares its scale yet.
     *
     * So each keystroke reports the value and its unit, and the
     * caller redraws the pending geometry at that size. Nothing is
     * committed by doing so: this is a preview, and the sheet only
     * changes when the student presses Enter.
     */
    notifyPreview();
  });

  const notifyPreview = () => {
    const raw = input.value.trim();
    const numeric = Number(raw);

    if (raw === "" || !Number.isFinite(numeric)) {
      return;
    }

    options.onPreview?.(
      index,
      numeric,
      chosen.unit
    );
  };

  /*
   * The student picked a different unit for this value.
   *
   * The number in the field is CONVERTED rather than left alone.
   * Leaving "500" untouched while the unit became "m" would
   * silently turn a half-metre member into a five-hundred-metre
   * one the instant Enter was pressed - the field would be
   * claiming one thing and meaning another, which is the exact
   * failure a unit control exists to prevent.
   *
   * Only a field still showing its suggestion is converted. Once
   * the student has typed a number of their own it is theirs: it
   * would mean a different length in the new unit, and rewriting
   * it under the cursor would be worse than leaving them to
   * re-enter it. They have changed the unit deliberately, so a
   * number they typed is read in that new unit.
   *
   * The unit is part of the value, so changing it is as much an edit
   * of the length as changing the number is - and the drawing has
   * to follow it for exactly that reason. 0.75 in m and 750 in mm
   * are one length, and switching between them must not move the
   * member by a thousand.
   */
  unitEl.addEventListener("change", () => {
    const next = unitEl.value;

    if (!touched) {
      input.value = formatValue(
        convertSuggestion(input.value, chosen.unit, next)
      );
    }

    chosen.unit = next;
    clearError();

    notifyPreview();
  });

  /*
   * Validate one field's raw text.
   *
   * Returns the number, or null with the popup left open and an
   * explanation shown. A malformed entry must never reach the
   * caller: the document's scale is established from the first
   * creation dimension, so accepting "abc" would either throw or
   * - worse - store a scale derived from a value nobody meant.
   */
  const readField = (field) => {
    const raw = input.value.trim();

    const value = Number(raw);

    if (raw === "" || !Number.isFinite(value)) {
      showError(
        `Enter ${(field.label || "a length").toLowerCase()} as a number.`,
      );
      return null;
    }

    const minimum = field.allowZero ? 0 : field.min ?? 1e-9;

    if (value <= minimum || (value === 0 && !field.allowZero)) {
      showError(
        `${field.label || "Length"} must be greater than zero.`,
      );
      return null;
    }

    clearError();

    return value;
  };

  const advance = () => {
    const field = fields[index];

    const value = readField(field);

    if (value === null) {
      return;
    }

    collected[index] = {
      value,
      unit: chosen.unit
    };

    index += 1;

    if (index < fields.length) {
      renderStep();
      return;
    }

    /*
     * Every field is answered. The popup is removed BEFORE the
     * callback runs, so the caller's geometry work happens with
     * no popup on the canvas and no chance of the popup being
     * left behind if the callback throws.
     */
    const values = collected.slice(0, fields.length);

    close();

    options.onConfirm?.(values);
  };

  /*
   * =========================================================
   * WHERE THE POINTER WENT, WHICH IS NOT WHERE FOCUS WENT
   * =========================================================
   *
   * The dismissal used to be decided by `popup.contains(document.activeElement)`,
   * and that is the fault. `activeElement` can only ever be a FOCUSABLE element:
   * clicking a label, the padding, the gap between rows or any other inert part
   * of the popup blurs the input and leaves focus on `<body>`, which the popup
   * does not contain - so a click INSIDE the popup read as a click OUTSIDE it and
   * the question closed under the student's hand. That is exactly the reported
   * "you have to click one specific part of the control".
   *
   * So the question asked here is the right one: DID THE PRESS LAND IN THE POPUP?
   * A `pointerdown` listener records the answer in the capture phase - before any
   * blur can fire - and the blur handlers consult it. A press that lands inside
   * keeps the popup; only a press that genuinely lands elsewhere dismisses it,
   * which is the behaviour that was wanted all along.
   */
  let pointerInside = false;

  const onPointerDown = (event) => {
    pointerInside = popup.contains(event.target);
  };

  document.addEventListener("pointerdown", onPointerDown, true);

  const pressWasInsidePopup = () => pointerInside;

  /*
   * The listener belongs to the DOCUMENT, so it must come off with the popup -
   * otherwise closing and reopening the editor would leave one stale listener per
   * closed popup, each still writing to a detached `pointerInside`. `close()` is
   * the module's own teardown and removes it by this reference.
   */
  pointerListener = onPointerDown;

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();

      advance();
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();

      closeIt();
    }
  });

  /*
   * Losing the popup is a cancel - but only if focus left the popup
   * ITSELF.
   *
   * The test used to be "did the text input lose focus", which was
   * right when the number was the only control here. It is now two
   * controls sharing one box, so the unit selector is part of the
   * popup too, and a click on it blurs the number without the
   * student having gone anywhere. Checking the input alone made
   * picking a unit cancel the question - the popup destroyed
   * itself on the first interaction with its own unit control.
   *
   * So the whole popup is checked, and focus is restored afterwards
   * when it is still open: after choosing a unit the student should
   * be back in the number, where Enter continues the workflow.
   */
  input.addEventListener("blur", () => {
    if (!openPopup) {
      return;
    }

    window.setTimeout(() => {
      if (openPopup !== popup || pressWasInsidePopup()) {
        return;
      }

      closeIt();
    }, 0);
  });

  /*
   * Choosing a unit hands focus to the selector, which is correct -
   * it is the control being used. When the popup is still open, the
   * number is put back in charge so the keyboard flow (Enter to
   * commit, Escape to cancel) is never interrupted by having merely
   * picked a unit.
   */
  unitEl.addEventListener("blur", () => {
    if (!openPopup || openPopup !== popup) {
      return;
    }

    window.setTimeout(() => {
      if (openPopup !== popup) {
        return;
      }

      if (pressWasInsidePopup()) {
        /*
         * The pointer is still inside the popup - the student clicked a label,
         * the padding or another control - so the question stands and the number
         * takes focus back for the keyboard flow.
         */
        input.focus();

        return;
      }

      closeIt();
    }, 0);
  });

  /*
   * ENTER CONFIRMS FROM ANY CONTROL IN THE POPUP.
   *
   * The student types the number, chooses the unit, then presses Enter - so
   * the Enter often arrives while the UNIT SELECT has focus rather than the
   * number. Listening on the popup catches every keydown inside it, from
   * whichever control is being used, so that rhythm always commits and an
   * Apply click is never needed.
   *
   * The number's own handler already stops its Enter from reaching here, so
   * a single confirmation is never doubled.
   */
  popup.addEventListener("keydown", event => {
    if (event.key !== "Enter") {
      return;
    }

    if (event.target === input) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    advance();
  });

  /*
   * ESCAPE CANCELS FROM ANYWHERE IN THE POPUP, FOCUSED OR NOT.
   *
   * The number's own handler above catches Escape only while the INPUT holds
   * focus. Clicking any part of the popup that cannot take focus - its padding,
   * its label, a blank corner - blurs the input, and from that moment there is no
   * focused element inside the popup for a keydown to reach it through. Escape
   * then did nothing at all, which is how "the popup will not close" happens to
   * a student who simply clicked the wrong few pixels first.
   *
   * So Escape is also caught ON THE DOCUMENT, for as long as this popup is the
   * open one. It is the same close the input's handler performs, into the same
   * single `closeIt`, so the two paths cannot behave differently - and the
   * listener is removed by `close()` with the popup.
   */
  const onDocumentKeyDown = (event) => {
    if (event.key !== "Escape" || openPopup !== popup) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    closeIt();
  };

  document.addEventListener("keydown", onDocumentKeyDown, true);

  /* Registered on the document, so it must come off with the popup. */
  escapeListener = onDocumentKeyDown;

  renderStep();

  return popup;
}

/*
 * Close without invoking any callback.
 *
 * Used by `open` to clear a previous popup, and by the editor
 * when it wants the popup gone without a cancel notification -
 * a tool change, a file load, a sheet switch.
 */
function close() {
  if (openPopup) {
    openPopup.remove();
    openPopup = null;
  }

  /*
   * AND THE POPUP'S OWN POINTER LISTENER COMES OFF WITH IT.
   *
   * It is registered on the DOCUMENT, so leaving it behind would keep one stale
   * listener per closed popup alive for the life of the page, each still writing
   * to the `pointerInside` of a popup that no longer exists.
   */
  if (pointerListener) {
    document.removeEventListener("pointerdown", pointerListener, true);

    pointerListener = null;
  }

  if (escapeListener) {
    document.removeEventListener("keydown", escapeListener, true);

    escapeListener = null;
  }

  closeCurrent = null;
}

function isOpen() {
  return openPopup !== null;
}

/*
 * Escape routed from the document level.
 *
 * The popup handles Escape from its own field, but the canvas
 * may hold focus, and an Escape pressed there has to cancel the
 * creation too - not silently close the popup and leave the
 * geometry committed. Returns true when it consumed the key, so
 * the editor knows the tool's own Escape handling should not
 * also run.
 */
function handleEscape() {
  if (!openPopup) {
    return false;
  }

  const closeIt = closeCurrent;

  closeIt?.();

  return true;
}

const enggCreationDimension = {
  close,
  handleEscape,
  isOpen,
  open,
};

export default enggCreationDimension;

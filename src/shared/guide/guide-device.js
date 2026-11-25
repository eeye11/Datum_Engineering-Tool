/*
 * ============================================================
 * WHICH DEVICE IS THIS?
 * ============================================================
 *
 * The guide teaches the same tutorials to everyone. What changes is the WORDING
 * and the POINTER: a laptop is told to click and drag with the mouse, a tablet
 * to tap and drag with a finger or stylus. This module answers the one question
 * both of those depend on, and it answers it from what the student actually
 * DID rather than from what the browser says the hardware is.
 *
 * WHY REAL EVENTS AND NOT `navigator.userAgent`
 * --------------------------------------------
 * A user agent describes the machine, and the machine is the wrong question. A
 * touchscreen laptop is a laptop with a mouse until the student touches it; a
 * tablet with a paired mouse is being used with a mouse. What matters is the
 * input in the student's hands RIGHT NOW, and the only reliable evidence of
 * that is the last meaningful pointer event.
 *
 * `pointerType` is the browser's own answer to "was that a mouse, a finger or a
 * pen", reported per event by the pointer events API. A pen is treated as touch
 * because a stylus is held and used like a finger - the instruction "tap" is
 * right for both, and "click" is wrong for both.
 *
 * THREE RULES, IN ORDER
 * ---------------------
 *   1. a MANUAL choice wins for the rest of the session and is never
 *      overwritten by detection;
 *   2. otherwise the mode follows the most recent meaningful input;
 *   3. with no usable history at all, the mode is LAPTOP - the conservative
 *      default, because "click" is comprehensible on a touchscreen while "tap"
 *      is confusing with a mouse.
 */

/* The two modes. There is deliberately no "automatic" mode to choose. */
export const DEVICE_MODES = Object.freeze({
  LAPTOP: "laptop",
  TOUCH: "touch",
});

export const DEVICE_OPTIONS = Object.freeze([
  {
    value: DEVICE_MODES.LAPTOP,
    label: "Laptop / desktop (mouse and keyboard)",
    short: "Mouse and keyboard",
    icon: "monitor",
  },
  {
    value: DEVICE_MODES.TOUCH,
    label: "Touchscreen / stylus",
    short: "Touchscreen / stylus",
    icon: "touch",
  },
]);

/* The default, and the answer when nothing has been observed. */
const DEFAULT_MODE = DEVICE_MODES.LAPTOP;

/*
 * THE SESSION'S STATE.
 *
 * `mode` is what the interface is showing; `manual` is whether the student set
 * it themselves. Both are module-level because there is one guide, one student
 * and one session - and because the selection page and the tutorial header must
 * show the SAME value, which is easiest to guarantee with one value.
 */
let mode = DEFAULT_MODE;
let manual = false;

/* Listeners that want to know when the mode changes (the guide's two screens). */
const listeners = new Set();

/*
 * The pointer events that count as "meaningful".
 *
 * NOT `pointermove`: moving a mouse across the window says nothing about which
 * device the student intends to use, and a palm brushing a trackpad would flip
 * the mode mid-sentence. A press is a deliberate act, and so is a wheel.
 */
const MEANINGFUL_EVENTS = ["pointerdown", "touchstart", "mousedown", "wheel"];

/*
 * A pen is a stylus, and a stylus is used like a finger.
 *
 * The type is read from the event's own `pointerType`, and falls back to the
 * event TYPE when that is absent: `touchstart` is only ever touch, and a
 * `mousedown` is only ever a mouse. Real browsers report `pointerType` on every
 * pointer event; the fallback keeps the detection honest in an engine that does
 * not - which is also what makes it testable.
 */
function modeForEvent(event) {
  const type = String(event?.pointerType || "").toLowerCase();

  if (type === "touch" || type === "pen") {
    return DEVICE_MODES.TOUCH;
  }

  if (type === "mouse") {
    return DEVICE_MODES.LAPTOP;
  }

  if (event?.type === "touchstart") {
    return DEVICE_MODES.TOUCH;
  }

  if (event?.type === "mousedown" || event?.type === "wheel") {
    return DEVICE_MODES.LAPTOP;
  }

  return null;
}

/*
 * Note an input, and follow it unless the student has chosen.
 *
 * The event is inspected rather than the listener name because `pointerdown`
 * carries the `pointerType` that actually answers the question. A `touchstart`
 * is a fallback for an engine with no pointer events, and it can only mean
 * touch.
 */
function observe(event) {
  if (manual) {
    return;
  }

  const next = modeForEvent(event);

  if (next && next !== mode) {
    mode = next;
    notify();
  }
}

/*
 * START WATCHING.
 *
 * Called once when the guide opens, and stopped when it closes - the detection
 * is only needed while the guide is on screen, and leaving listeners on the
 * document for the whole session would be a cost nobody asked for.
 *
 * CAPTURE PHASE: the events are heard wherever they land, including on a canvas
 * that stops propagation, so a press on the drawing is not missed.
 */
let watching = false;

function startWatching() {
  if (watching) {
    return;
  }

  watching = true;

  MEANINGFUL_EVENTS.forEach((type) => {
    document.addEventListener(type, observe, { capture: true, passive: true });
  });
}

function stopWatching() {
  if (!watching) {
    return;
  }

  watching = false;

  MEANINGFUL_EVENTS.forEach((type) => {
    document.removeEventListener(type, observe, { capture: true });
  });
}

/*
 * ============================================================
 * WHAT THE REST OF THE GUIDE ASKS
 * ============================================================
 */

export function currentMode() {
  return mode;
}

/* Whether the student has taken control, so the UI can say so if it wants to. */
export function isManual() {
  return manual;
}

/*
 * SET THE MODE, BY THE STUDENT.
 *
 * A manual choice is sticky: detection stops overriding it from this moment
 * until the guide closes. That is what makes the dropdown trustworthy - a
 * student who says "I am on a tablet" is not contradicted by the trackpad they
 * happen to brush.
 */
export function setMode(next, { fromStudent = true } = {}) {
  if (!Object.values(DEVICE_MODES).includes(next)) {
    return mode;
  }

  if (fromStudent) {
    manual = true;
  }

  if (next !== mode) {
    mode = next;
    notify();
  }

  return mode;
}

/* Subscribe to changes. Returns the unsubscribe function. */
export function onModeChange(listener) {
  listeners.add(listener);

  return () => listeners.delete(listener);
}

function notify() {
  listeners.forEach((listener) => {
    try {
      listener(mode);
    } catch (error) {
      /* A listener that throws must not stop the others. */
    }
  });
}

/*
 * A NEW GUIDE SESSION.
 *
 * The manual preference belongs to the session, not to the browser, so opening
 * the guide again detects afresh. `reset` is what `open()` calls.
 */
export function beginSession() {
  manual = false;
  mode = DEFAULT_MODE;

  startWatching();
}

export function endSession() {
  stopWatching();

  manual = false;
  mode = DEFAULT_MODE;
}

/* The option record for a value, so a caller can render its label and icon. */
export function optionFor(value) {
  return (
    DEVICE_OPTIONS.find((option) => option.value === value) || DEVICE_OPTIONS[0]
  );
}

/*
 * ============================================================
 * THE DROPDOWN
 * ============================================================
 *
 * One function builds the control, so the selection page and the tutorial
 * header cannot drift apart in markup, options or behaviour. The caller
 * supplies the extra classes it wants (a compact variant in the header) and the
 * id its screen needs.
 *
 * IT IS A NATIVE `<select>`. A custom popup would need its own keyboard
 * handling, its own outside-click dismissal and its own positioning, and the
 * platform's own list is already reachable by keyboard, by a screen reader and
 * by touch. The guide's job is to be usable, not to re-implement a dropdown.
 */
export function deviceSelectHtml({ id, className = "" } = {}) {
  const option = optionFor(mode);

  return `
    <label class="datum-device ${className}" for="${id}">
      <span class="datum-device-icon" aria-hidden="true">${deviceIcon(option.icon)}</span>
      <span class="datum-device-label">What device are you using?</span>
      <span class="datum-device-control">
        <select id="${id}" class="datum-device-select" data-device-select>
          ${DEVICE_OPTIONS.map(
            (choice) => `
            <option value="${choice.value}" ${choice.value === mode ? "selected" : ""}>
              ${choice.label}
            </option>
          `,
          ).join("")}
        </select>
        <span class="datum-device-caret" aria-hidden="true">
          <svg viewBox="0 0 12 12" width="10" height="10" focusable="false">
            <path d="M2.5 4.25L6 7.75l3.5-3.5" fill="none" stroke="currentColor"
              stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </span>
      </span>
    </label>
  `;
}

/*
 * THE TWO DEVICE MARKS, drawn in the application's own icon language: a 20x20
 * viewBox, one stroke, round caps and joins, `currentColor`.
 */
const STROKE =
  'fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"';

function deviceIcon(name) {
  const path =
    name === "touch"
      ? `<rect ${STROKE} x="6" y="2.5" width="8" height="15" rx="1.5"/><path ${STROKE} d="M9 15.5h2"/>`
      : `<rect ${STROKE} x="2.5" y="4" width="15" height="10" rx="1"/><path ${STROKE} d="M7 17h6M10 14v3"/>`;

  return `<svg viewBox="0 0 20 20" width="16" height="16" focusable="false">${path}</svg>`;
}

export default {
  DEVICE_MODES,
  DEVICE_OPTIONS,
  currentMode,
  isManual,
  setMode,
  onModeChange,
  beginSession,
  endSession,
  optionFor,
  deviceSelectHtml,
};

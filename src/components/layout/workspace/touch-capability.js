/*
 * ========================================================
 * SAYING ONCE WHETHER THIS DEVICE CAN BE TOUCHED
 * ========================================================
 *
 * A control sized for a cursor is hard to hit with a fingertip, so on a device
 * that can be touched the buttons, number fields and tabs are given a little
 * more room (see `.datum-touch-input` in responsive.css). That is the only thing
 * this module decides.
 *
 * WHY A CLASS RATHER THAN A MEDIA QUERY.
 *
 * `@media (pointer: coarse)` asks the browser the same question, and it is the
 * obvious answer - except that the rest of the layout in this application is
 * deliberately WIDTH-DRIVEN, so that a resized desktop window and a tablet of
 * the same size look and behave identically. A device query for SIZING would
 * be a second, independent rule about the hardware, and the two would
 * eventually disagree: the same window would be more spacious merely because
 * the machine had a touchscreen.
 *
 * More importantly, `pointer` describes the PRIMARY pointer, and a touchscreen
 * laptop reports `fine` for it until someone touches the screen - so a media
 * query would give the worst answer on exactly the machines this feature is
 * for. Reading the CAPABILITIES instead asks the honest question: HAS THIS
 * DEVICE GOT A TOUCHSCREEN AT ALL? That does not change when the user switches
 * to a mouse, and the sizing then stays put.
 *
 * WHAT IT DOES NOT DO.
 *
 * It does not disable anything, change any gesture, or detect a stylus. It
 * sets one class and stops. `maxTouchPoints` is the one signal used, because it
 * is the one every current browser reports truthfully - a device with no
 * touchscreen reports zero on all of them.
 */
const TOUCH_CLASS = "datum-touch-input";

/**
 * Does this page run on a device with a touchscreen?
 *
 * Deliberately tolerant: `navigator` may be absent (a test harness, a worker)
 * and `maxTouchPoints` may be undefined on an old browser. Both answer "no",
 * which leaves the established desktop sizing in place.
 */
function deviceCanBeTouched() {
  const points = Number(globalThis.navigator?.maxTouchPoints);

  return Number.isFinite(points) && points > 0;
}

/**
 * Set (or clear) the capability class on the document element. Called once at
 * start-up, before anything is drawn, so no control is ever laid out at the
 * wrong size and then resized under the student's finger.
 */
export function installTouchInputClass() {
  const root = globalThis.document?.documentElement;

  if (!root?.classList) {
    return false;
  }

  const touch = deviceCanBeTouched();

  root.classList.toggle(TOUCH_CLASS, touch);

  return touch;
}

export default installTouchInputClass;

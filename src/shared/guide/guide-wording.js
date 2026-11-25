/*
 * ============================================================
 * THE SAME STEP, SAID FOR THE DEVICE IN HAND
 * ============================================================
 *
 * There is ONE tutorial library. A step says what to achieve - arm the
 * Rectangle tool, draw a rectangle, select the line - and that is the same
 * requirement whether the student has a mouse or a stylus. What changes is the
 * words: "click" versus "tap", "release the mouse button" versus "lift your
 * finger or stylus".
 *
 * WHY SUBSTITUTION RATHER THAN TWO TEXTS PER STEP
 * -----------------------------------------------
 * Authoring both wordings for every step means two things to keep true, and
 * they drift the first time somebody edits one. A single authored sentence plus
 * one audited table of input words keeps the LEARNING OBJECTIVE in one place
 * and makes the difference between the modes exactly what it is: vocabulary.
 *
 * Each rule below is a word or phrase the application's own instructions use,
 * paired with what a touch user would call the same act. They are ordered, and
 * the longer phrases come first so "press and drag" is not mangled by the
 * "press" rule.
 *
 * WHAT IS DELIBERATELY NOT TRANSLATED
 * -----------------------------------
 * Keyboard shortcuts and keys. A touchscreen has no Shift key, so a step whose
 * text mentions one keeps saying so - and the step's TOUCH wording drops the
 * keyboard hint rather than pretending the key exists. `dropForTouch` below is
 * the small list of sentences that only make sense with a keyboard.
 */

/*
 * The substitution table. `mouse` is what the authored text says; `touch` is
 * what a finger or stylus does instead.
 *
 * ORDER MATTERS: entries are applied in sequence, so a phrase must not be a
 * substring of one that should be replaced first.
 */
const INPUT_WORDS = [
  /*
   * DOUBLE-CLICK COMES FIRST, under its own pass.
   *
   * It shares a hyphen with "click", and a second pass is what stops the
   * "click" rule breaking the phrase apart before this one sees it. See
   * `instructionFor` - the first pass replaces, the second fixes the case.
   */
  { mouse: /double-click/gi, touch: "tap twice quickly" },
  { mouse: /double click/gi, touch: "tap twice quickly" },

  /* Whole gestures first, before their component verbs. */
  { mouse: /click and hold/gi, touch: "press and hold" },
  { mouse: /press and drag/gi, touch: "press and drag" },
  {
    mouse: /press at the start and drag/gi,
    touch: "press at the start and drag",
  },
  { mouse: /click once for each end/gi, touch: "tap once for each end" },
  { mouse: /click once/gi, touch: "tap once" },
  { mouse: /click each/gi, touch: "tap each" },
  { mouse: /click again/gi, touch: "tap again" },

  /* Releasing a button versus lifting a finger. */
  { mouse: /release the mouse button/gi, touch: "lift your finger or stylus" },
  {
    mouse: /releasing the mouse button/gi,
    touch: "lifting your finger or stylus",
  },
  { mouse: /on release/gi, touch: "when you lift off" },
  { mouse: /release/gi, touch: "lift off" },

  /* The pointer itself. */
  { mouse: /moving the mouse/gi, touch: "moving your finger or stylus" },
  { mouse: /move your mouse/gi, touch: "move your finger or stylus" },
  { mouse: /move the mouse/gi, touch: "move your finger or stylus" },
  { mouse: /the mouse wheel/gi, touch: "a two-finger pinch" },
  { mouse: /mouse wheel/gi, touch: "pinch gesture" },
  { mouse: /mouse/gi, touch: "finger or stylus" },

  /* Hover: not available on a touchscreen. */
  { mouse: /hover the pointer over/gi, touch: "tap" },
  { mouse: /on hover/gi, touch: "when tapped" },
  { mouse: /hover/gi, touch: "tap" },

  /* Double-click, which a touchscreen does with two quick taps. */
  { mouse: /double-click/gi, touch: "tap twice quickly" },
  { mouse: /double click/gi, touch: "tap twice quickly" },

  /* The plain verb, last so the phrases above win. */
  { mouse: /clicking/gi, touch: "tapping" },
  { mouse: /clicked/gi, touch: "tapped" },
  { mouse: /click/gi, touch: "tap" },
];

/*
 * SENTENCES THAT ONLY MAKE SENSE WITH A KEYBOARD.
 *
 * A touchscreen has no Shift, no Escape and no Ctrl. Rather than leave a touch
 * student hunting a key that is not on their device, a sentence that names one
 * is dropped from the touch wording - the step still says what to do, and the
 * keyboard-only option simply is not offered.
 */
const KEYBOARD_ONLY = [
  /\bShift\b/,
  /\bEscape\b/,
  /\bCtrl\b/,
  /\bAlt\b/,
  /\bpress the [A-Z]\b/,
  /\bkeyboard\b/i,
];

/*
 * THE INSTRUCTION FOR A MODE.
 *
 * `text` is the authored sentence (written for a mouse, which is the default
 * mode), and the touch wording is derived from it. An authored `touch` on the
 * step wins, for the rare case where the difference is not vocabulary but a
 * genuinely different sequence - and there are none today, which is why the
 * table above exists.
 */
export function instructionFor(text, mode, step = null) {
  if (!text) {
    return "";
  }

  if (mode !== "touch") {
    return text;
  }

  if (step?.touch) {
    return step.touch;
  }

  const dropped = text
    .split(/(?<=[.!?])\s+/)
    .filter(
      (sentence) => !KEYBOARD_ONLY.some((pattern) => pattern.test(sentence)),
    )
    .join(" ");

  const replaced = INPUT_WORDS.reduce(
    (result, rule) => result.replace(rule.mouse, rule.touch),
    dropped || text,
  );

  /*
   * THE CAPITAL IS PUT BACK, AND THAT IS NOT COSMETIC.
   *
   * A case-insensitive match replaces "Click" with "tap" at the start of a
   * sentence, so the instruction would open in lower case - which reads as a
   * typo and makes the guide look unfinished. A replacement that landed at a
   * sentence boundary is capitalised; one inside a sentence is left alone.
   */
  return replaced.replace(
    /(^|[.!?]\s+)([a-z])/g,
    (match, lead, letter) => lead + letter.toUpperCase(),
  );
}

/*
 * THE SHORT INSTRUCTION SHOWN IN THE HEADER OF A STEP ("your turn"), which is
 * authored separately and translated the same way.
 */
export function taskFor(step, mode) {
  if (!step?.perform) {
    return "";
  }

  return instructionFor(step.perform, mode, step);
}

/* The gesture a step teaches, as the mode would perform it. */
export function gestureLabel(gesture, mode) {
  const laptop = {
    click: "Click",
    press: "Press",
    drag: "Drag",
    scroll: "Scroll",
  };

  const touch = {
    click: "Tap",
    press: "Press and hold",
    drag: "Drag",
    scroll: "Pinch",
  };

  const table = mode === "touch" ? touch : laptop;

  return table[gesture] || table.click;
}

export default {
  instructionFor,
  taskFor,
  gestureLabel,
};

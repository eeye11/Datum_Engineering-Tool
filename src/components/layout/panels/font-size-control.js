/*
 * ============================================================
 * THE QUICK-ACCESS FONT SIZE
 * ============================================================
 *
 * One control in the existing quick-access toolbar for the size of canvas text,
 * wherever the student is working - a note, a label, a dimension's number, a
 * graph's axis. Without it, changing the size of four dimensions means opening
 * four Features panels in turn.
 *
 * ONE PROPERTY, FOUR VIEWS
 * ------------------------
 * There is no second size field and no second default. `style.fontSize` is the
 * property every text-bearing object carries, the Features panel already edits,
 * and the canvas paints - and this control reads and writes THAT, through the
 * shared typography system (`shared/typography/canvas-typography.js`).
 *
 *     one size in the selection   it is shown, and changed in place
 *     several sizes selected      a MIXED state: blank field, and a choice
 *                                 applies to every applicable element
 *     nothing text-bearing        the DEFAULT for the next text, on
 *                                 `styleDefaults.fontSize`
 *
 * SCREEN PIXELS, NOT POINTS
 * -------------------------
 * A canvas font size is a SCREEN size. The number here is what the glyphs
 * measure on the monitor, and it does not change when the drawing is zoomed.
 * The printed point size a TikZ figure states is a separate, derived figure -
 * see `dimension-label` for how a dimension states both.
 *
 * UNDOABLE, AND COMMITTED LIKE ANY OTHER STYLE CHANGE
 * ---------------------------------------------------
 * A change to a selection is one undo entry (`commitDrawingChange`), exactly as a
 * colour change is, and it redraws, re-renders the panel and - because the source
 * is generated from the object - rewrites the block. Nothing here writes source
 * itself; there is one object model and everything reads it.
 *
 * WHAT COUNTS AS TEXT-BEARING
 * ---------------------------
 * An object whose APPEARANCE IS TYPE: an Annotate family member, a dimension.
 * Anything else is geometry, and selecting it shows the default instead - which
 * is what the next text will be drawn at.
 */
import enggDrawingState from "../../../shared/model/drawing-state.js";
import {
  drawingFontControl,
  drawingFontSize,
  drawingFontSizeMenu,
  drawingThickness,
  drawingColor,
  drawingLineType,
} from "../../../features/workspace/dom.js";
import { drawingState } from "../../../features/workspace/editor-state.js";
import { renderCurrentDrawing } from "../workspace/canvas-render.js";
import { renderProperties } from "./feature-panel.js";
import {
  DEFAULT_CANVAS_FONT_PX,
  FONT_PX_MAX,
  FONT_PX_MIN,
  FONT_SIZE_CHOICES,
  LINE_SPACING,
  textHeightEstimate,
  textWidthEstimate,
} from "../../../shared/typography/canvas-typography.js";
import { isHeatLabelObject } from "../../../features/workspace/model/heat-transfer/heat-labels.js";

/*
 * `syncStyleControls` IS IMPORTED INSIDE THE CALLS, not at the top.
 *
 * `style-controls.js` calls `syncFontSizeControl` from its own sync, so a static
 * import back from here would make the two modules circular. The cycle resolves
 * in a browser, but a cycle between two modules that both run work at load time
 * is the kind of coupling that breaks in a different bundler - and the call is
 * never on a hot path, so a dynamic import costs nothing.
 */
function syncLineStyleControls() {
  return import("./style-controls.js").then((mod) => mod.syncStyleControls());
}

/* The default size a NEW piece of canvas text is drawn at. */
export const DEFAULT_FONT_SIZE_PT = DEFAULT_CANVAS_FONT_PX;

/*
 * THE TYPES WHOSE LOOK IS TYPE.
 *
 * An Annotate feature - whose size lives in `style.fontSize` - and a dimension,
 * which does the same. Anything else that happens to carry the field is not a
 * text object and is left alone.
 */
const TEXT_TYPES = Object.freeze(["dimension", "annotate"]);

/*
 * THE PROPERTIES AN OBJECT STATES ITS SIZE WITH.
 *
 * `style.fontSize` is the ONE property. `style.labelSize` is where a Heat
 * Transfer label and a feature's own label keep theirs, and it is the same
 * canvas size - so a size chosen in this control reaches it too rather than
 * quietly having no effect on the labels the student can see.
 */
function sizeFieldsOf(object) {
  return isHeatLabelObject(object) || Number(object?.style?.labelSize) > 0
    ? ["fontSize", "labelSize"]
    : ["fontSize"];
}

/* The size an object is actually drawn at, or null when it has none. */
export function fontSizeOfObject(object) {
  if (!object || !TEXT_TYPES.includes(object.type)) {
    return null;
  }

  const stored = Number(object?.style?.fontSize) > 0
    ? Number(object.style.fontSize)
    : Number(object?.style?.labelSize) > 0
      ? Number(object.style.labelSize)
      : null;

  return stored;
}

export function isTextSizedObject(object) {
  return Boolean(object && TEXT_TYPES.includes(object.type));
}

/* Every selected object whose size this control applies to. */
function selectedTextObjects() {
  const ids = drawingState.selection?.selectedObjectIds || [];

  if (!ids.length) {
    return [];
  }

  return drawingState.objects.filter(
    (object) => ids.includes(object.id) && isTextSizedObject(object),
  );
}



/*
 * THE STATE OF THE CONTROL, read from the model.
 *
 *   scope "selection"   `sizes` holds one or more DISTINCT sizes
 *   scope "default"     nothing text-bearing is selected; `size` is the default
 *
 * A `mixed` view is simply "scope selection with more than one distinct size",
 * so there is no separate flag to keep in step with the selection.
 */
export function fontSizeState() {
  const targets = selectedTextObjects();

  if (!targets.length) {
    const fallback = Number(drawingState.styleDefaults?.fontSize);

    return {
      scope: "default",
      size: Number.isFinite(fallback) && fallback > 0 ? normaliseFontSize(fallback) : DEFAULT_CANVAS_FONT_PX,
      sizes: [],
      count: 0,
    };
  }

  const sizes = [];

  targets.forEach((object) => {
    const size = fontSizeOfObject(object) ?? DEFAULT_CANVAS_FONT_PX;

    if (!sizes.includes(size)) {
      sizes.push(size);
    }
  });

  return {
    scope: "selection",
    size: sizes[0],
    sizes,
    mixed: sizes.length > 1,
    count: targets.length,
  };
}

/* A size as the field states it: a finite number of pixels in range. */
export function normaliseFontSize(value, fallback = DEFAULT_CANVAS_FONT_PX) {
  const size = Number(value);

  if (!Number.isFinite(size) || size <= 0) {
    return fallback;
  }

  return Math.min(FONT_PX_MAX, Math.max(FONT_PX_MIN, Math.round(size * 100) / 100));
}

/*
 * WRITE THE SIZE ONTO THE SELECTION, OR INTO THE DEFAULT.
 *
 * `commit` is taken BEFORE anything changes, so the whole edit is one undo entry
 * that restores the previous sizes exactly - including a multi-selection, where
 * four labels change at once and one Undo puts all four back.
 *
 * ONLY `style` IS TOUCHED. The measurement points, the placement, the colour and
 * every other property are left exactly as they were - a font size is not a
 * geometry edit, and a dimension that changed its measurement because its
 * number grew would be a lie about the drawing.
 */
export function applyFontSize(value) {
  const size = normaliseFontSize(value);
  const targets = selectedTextObjects();

  if (!targets.length) {
    drawingState.styleDefaults = {
      ...drawingState.styleDefaults,
      fontSize: size,
    };

    void syncLineStyleControls();

    return { scope: "default", size };
  }

  const previous = enggDrawingState.snapshotDrawing(drawingState);

  targets.forEach((object) => {
    const style = { ...(object.style || {}), fontSize: size };

    sizeFieldsOf(object).forEach((field) => {
      style[field] = size;
    });

    object.style = style;
  });

  enggDrawingState.commitDrawingChange(drawingState, previous);

  void syncLineStyleControls();
  renderProperties();
  renderCurrentDrawing();

  return { scope: "selection", size, count: targets.length };
}

/*
 * WHAT THE CONTROL SAYS.
 *
 * The field shows the selection's size, or the default when nothing text-bearing
 * is selected. With SEVERAL sizes it is left EMPTY and the box is marked as
 * mixed - a number there would claim one of them is the answer, and there is no
 * answer until the student picks one.
 */
export function syncFontSizeControl() {
  if (!drawingFontSize) {
    return;
  }

  const state = fontSizeState();

  /* Never fight a half-typed value in the field the student is using. */
  if (document.activeElement !== drawingFontSize) {
    drawingFontSize.value = state.mixed ? "" : String(normaliseFontSize(state.size));
  }

  drawingFontSize.placeholder = state.mixed ? "Mixed" : "";

  const label = state.mixed
    ? `Text size: mixed (${state.sizes.join(", ")} px)`
    : state.scope === "selection"
      ? `Text size: ${normaliseFontSize(state.size)} px`
      : `Default text size: ${normaliseFontSize(state.size)} px (nothing selected)`;

  drawingFontSize.setAttribute("title", label);
  drawingFontSize.setAttribute("aria-label", label);

  if (drawingFontControl) {
    drawingFontControl.classList.toggle("is-mixed", Boolean(state.mixed));
    drawingFontControl.setAttribute("title", label);
  }

  syncMenu(state);
}

/*
 * THE DROPDOWN REFLECTS THE FIELD, and never claims a value the field does not
 * hold: a mixed or custom size is shown as one of the two HIDDEN options, so the
 * select has a selection without offering it as a choice.
 */
function syncMenu(state) {
  if (!drawingFontSizeMenu) {
    return;
  }

  const size = normaliseFontSize(state.size);

  const choice = FONT_SIZE_CHOICES.includes(size) ? String(size) : "custom";

  drawingFontSizeMenu.value = state.mixed ? "mixed" : choice;

  /*
   * A MIXED STATE ALSO OPENS A DISABLED PLACEHOLDER AS ITS SELECTION, which is
   * what makes the menu itself say "Mixed" rather than showing one of the
   * disagreeing sizes. The placeholder is hidden from the list, so it can be a
   * current value without ever being a choice.
   */
  if (state.mixed && drawingFontSizeMenu.querySelector('option[value="mixed"]')) {
      drawingFontSizeMenu.selectedIndex = 0;
  }

  drawingFontSizeMenu.setAttribute(
    "aria-label",
    state.mixed ? "Text size: mixed" : `Text size: ${size} px`,
  );
}

/*
 * WIRE THE CONTROL.
 *
 * `input` for a live preview while a number is typed, `change` for the commit -
 * the same two events the colour and thickness controls use, so dragging the
 * number spinner redraws continuously and releasing it records ONE undo entry.
 */
export function installFontSizeControl() {
  if (!drawingFontSize) {
    return;
  }

  const read = () => {
    const raw = drawingFontSize.value.trim();

    return raw === "" ? null : Number(raw);
  };

  drawingFontSize.addEventListener("input", () => {
    const value = read();

    if (value === null || !Number.isFinite(value) || value <= 0) {
      return;
    }

    applyFontSize(value);
  });

  drawingFontSize.addEventListener("change", () => {
    const value = read();

    if (value === null || !Number.isFinite(value)) {
      /* A blank field reverts to what is in force, rather than to 0. */
      syncFontSizeControl();

      return;
    }

    applyFontSize(value);
  });

  /*
   * A SIZE IS A NUMBER OF PIXELS between the established bounds. A value outside
   * them is not a typo to accept - it is unreadable or it is a page of type - so
   * the field is put back to the last good size.
   */
  drawingFontSize.addEventListener("blur", () => {
    syncFontSizeControl();
  });

  /*
   * THE KEY THAT CLOSES THE FIELD COMMITS IT, exactly as it does in every other
   * value control. Enter is what a student presses after typing a size, and
   * leaving the value uncommitted would make the field look broken.
   */
  drawingFontSize.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      drawingFontSize.blur();
    }

    if (event.key === "Escape") {
      event.preventDefault();
      syncFontSizeControl();
      drawingFontSize.blur();
    }
  });

  if (drawingFontSizeMenu) {
    /*
     * A CHOSEN SIZE IS APPLIED TO THE WHOLE SELECTION - or, with nothing
     * text-bearing selected, becomes the default. The menu is then put back to
     * the model's own state by the sync, so it can never display a choice the
     * drawing did not accept.
     */
    drawingFontSizeMenu.addEventListener("change", () => {
      const chosen = drawingFontSizeMenu.value;

      if (chosen === "mixed" || chosen === "custom") {
        syncFontSizeControl();

        return;
      }

      const size = Number(chosen);

      if (!Number.isFinite(size) || size <= 0) {
        syncFontSizeControl();

        return;
      }

      applyFontSize(size);
      syncFontSizeControl();
    });


  }

  syncFontSizeControl();
}

/*
 * THE LINE OF TEXT A LABEL TAKES, IN SCREEN PIXELS.
 *
 * Exported because the in-page editors size their own boxes with it: the box a
 * student types into must be the box the words will occupy, and the words are
 * drawn from the same shared typography rules.
 */
export function textBoxFor(text, size, options = {}) {
  const px = normaliseFontSize(size);

  return {
    size: px,
    width: textWidthEstimate(text, px, options),
    height: textHeightEstimate(text, px, { lineSpacing: options.lineSpacing || LINE_SPACING }),
  };
}

/* The three line controls the font control sits beside; exported for tests. */
export const FONT_CONTROL_SIBLINGS = [
  drawingThickness,
  drawingColor,
  drawingLineType,
];

export default {
  DEFAULT_FONT_SIZE_PT,
  isTextSizedObject,
  fontSizeOfObject,
  fontSizeState,
  normaliseFontSize,
  applyFontSize,
  syncFontSizeControl,
  installFontSizeControl,
  textBoxFor,
};

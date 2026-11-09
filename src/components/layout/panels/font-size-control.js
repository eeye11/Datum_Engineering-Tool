/*
 * ============================================================
 * THE QUICK-ACCESS FONT SIZE
 * ============================================================
 *
 * One control in the menu bar for the size of text, wherever the student is
 * working - a note, a label, a dimension's number. Without it, changing the size
 * of four dimensions means opening four Features panels in turn.
 *
 * ONE PROPERTY, THREE VIEWS
 * -------------------------
 * There is no new size field and no second default. `style.fontSize` is the
 * property every text object already carries, the Features panel already edits,
 * and the source writer already prints - and this control reads and writes THAT.
 *
 *     a selected text-sized object   its own size is shown, and changed in place
 *     nothing text-sized selected    the default for the next text is shown and set
 *
 * WHAT COUNTS AS TEXT-SIZED
 * -------------------------
 * The objects whose APPEARANCE IS TYPE: a dimension's number, and every Annotate
 * family that draws words. A line has no font size, so selecting one does not
 * make a size appear - it shows the default instead, which is what the next note
 * will be drawn at.
 *
 * DOCUMENT SPACE, NOT SCREEN SPACE
 * --------------------------------
 * The number in the field is POINTS - a document property. It is never derived
 * from the zoom, and changing the zoom never changes it. The canvas paints it at
 * that size through the drawing's own px-per-unit, which is a viewport transform
 * applied to the whole sheet, so a label and the geometry beside it scale
 * together.
 *
 * UNDOABLE, AND COMMITTED LIKE ANY OTHER STYLE CHANGE
 * ---------------------------------------------------
 * A change to a selection is one undo entry (`commitDrawingChange`), exactly as a
 * colour change is, and it redraws, re-renders the panel and - because the source
 * is generated from the object - rewrites the block. Nothing here writes source
 * itself; there is one object model and everything reads it.
 */
import enggDrawingState from "../../../shared/model/drawing-state.js";
import {
  drawingFontSize,
  drawingThickness,
  drawingColor,
  drawingLineType,
} from "../../../features/workspace/dom.js";
import { drawingState } from "../../../features/workspace/editor-state.js";
import { renderCurrentDrawing } from "../workspace/canvas-render.js";
import { renderProperties } from "./feature-panel.js";

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
    return import("./style-controls.js").then((module) => module.syncStyleControls());
}

/* The default size, in points, a new piece of text is drawn at. */
export const DEFAULT_FONT_SIZE_PT = 11;

/*
 * THE TYPES WHOSE LOOK IS TYPE.
 *
 * A dimension's number, and an Annotate feature. Both store `style.fontSize`, and
 * both print it; anything else that happens to carry the field is not a text
 * object and is left alone.
 */
const TEXT_TYPES = Object.freeze(["dimension", "annotate"]);

export function isTextSizedObject(object) {
  return Boolean(object && TEXT_TYPES.includes(object.type));
}

/* The selected object whose size this control shows, if there is one. */
function selectedTextObject() {
  const ids = drawingState.selection?.selectedObjectIds || [];

  if (!ids.length) {
    return null;
  }

  return (
    drawingState.objects.find(
      (object) => ids.includes(object.id) && isTextSizedObject(object),
    ) || null
  );
}

/* A size as the field states it: a finite number of points in range. */
export function normaliseFontSize(value, fallback = DEFAULT_FONT_SIZE_PT) {
  const size = Number(value);

  if (!Number.isFinite(size) || size <= 0) {
    return fallback;
  }

  return Math.min(200, Math.max(4, Math.round(size * 100) / 100));
}

/*
 * WRITE THE SIZE ONTO THE SELECTION, OR INTO THE DEFAULT.
 *
 * `commit` is taken BEFORE anything changes, so the whole edit is one undo entry
 * that restores the previous sizes exactly - including a multi-selection, where
 * four labels change at once and one Undo puts all four back.
 */
export function applyFontSize(value) {
  const size = normaliseFontSize(value);
  const selected = selectedTextObject();

  if (!selected) {
    drawingState.styleDefaults = {
      ...drawingState.styleDefaults,
      fontSize: size,
    };

    void syncLineStyleControls();

    return { scope: "default", size };
  }

  const ids = drawingState.selection?.selectedObjectIds || [];

  const targets = drawingState.objects.filter(
    (object) => ids.includes(object.id) && isTextSizedObject(object),
  );

  const previous = enggDrawingState.snapshotDrawing(drawingState);

  targets.forEach((object) => {
    /*
     * ONLY THE SIZE CHANGES. The measurement points, the placement, the
     * colour and every other property are left exactly as they were - a font
     * size is not a geometry edit.
     */
    object.style = {
      ...(object.style || {}),
      fontSize: size,
    };
  });

  enggDrawingState.commitDrawingChange(drawingState, previous);

  void syncLineStyleControls();
  renderProperties();
  renderCurrentDrawing();

  return { scope: "selection", size, count: targets.length };
}

/* Put the model's size into the control, and name it. */
export function syncFontSizeControl() {
  if (!drawingFontSize) {
    return;
  }

  const selected = selectedTextObject();

  const stored = Number(selected?.style?.fontSize);
  const fallback = Number(drawingState.styleDefaults?.fontSize);

  const value =
    Number.isFinite(stored) && stored > 0
      ? stored
      : Number.isFinite(fallback) && fallback > 0
        ? fallback
        : DEFAULT_FONT_SIZE_PT;

  /* Never fight a half-typed value in the field the student is using. */
  if (document.activeElement !== drawingFontSize) {
    drawingFontSize.value = String(normaliseFontSize(value));
  }

  const label = selected
    ? `Text size: ${normaliseFontSize(value)} pt`
    : `Default text size: ${normaliseFontSize(value)} pt`;

  drawingFontSize.setAttribute("title", label);
  drawingFontSize.setAttribute("aria-label", label);
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
   * A SIZE IS A NUMBER OF POINTS BETWEEN 4 AND 200. A value outside it is not
   * a typo to accept - it is unreadable or it is a page of type - so the field
   * is put back to the last good size.
   */
  drawingFontSize.addEventListener("blur", () => {
    syncFontSizeControl();
  });

  syncFontSizeControl();
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
  normaliseFontSize,
  applyFontSize,
  syncFontSizeControl,
  installFontSizeControl,
};

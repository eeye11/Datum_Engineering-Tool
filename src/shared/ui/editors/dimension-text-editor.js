/*
 * ============================================================
 * THE DIMENSION'S TEXT, EDITED IN PLACE
 * ============================================================
 *
 * A dimension's number is IN-PAGE TEXT - part of the dimension object, sitting
 * on the drawing where the model put it. Editing it is therefore a change to
 * that text where it stands, not a question asked in a popup:
 *
 *   - the field opens OVER the number, inside the canvas, at the number's own
 *     anchor, in the drawing's own type;
 *   - it follows the drawing when the student zooms or pans behind it;
 *   - Enter (or a click elsewhere) commits one undoable edit, Escape abandons
 *     it;
 *   - on commit the dimension's own VALUE is rewritten (`variable` content, for
 *     a driven dimension), so the text remains the dimension's - it is never
 *     turned into a free-standing text object.
 *
 * WHAT IT DOES NOT DO. It does not move the dimension, does not change what it
 * measures, and does not create a second object. The dimension's identity, its
 * references and its measurement stay exactly as they were; only the text it
 * displays is replaced, which is the one thing a student asked to change by
 * clicking the words.
 *
 * The projection and the box geometry come from `inline-text-entry.js`, the
 * same module the note editor uses - so a number is placed on the sheet by the
 * same arithmetic as every other piece of in-page text.
 */
import enggInlineEntry from "./inline-text-entry.js";
import {
  noteTextStyle,
  noteTextWidth,
} from "../../typography/note-text-style.js";
/*
 * THE FIELD'S TYPE COMES FROM THE SAME SYSTEM THE CANVAS PAINTS WITH.
 *
 * `src/shared/ui/editors/` to `src/shared/typography/` is up one and down one,
 * not straight across: a path that stopped at `../typography` would resolve to
 * `src/shared/ui/typography/`, which does not exist - and a module that cannot
 * resolve makes the WHOLE editor fail to load, not just this field.
 */
import {
  SECONDARY_FONT_PX,
  fontSizeOf,
} from "../../typography/canvas-typography.js";

let closeCurrent = null;

/* Close whichever field is open, abandoning its edit. */
function closeOpen() {
  closeCurrent?.();
}

/* Whether a dimension's in-page editor is open (for the canvas's own keys). */
function isOpen() {
  return typeof closeCurrent === "function";
}

/*
 * OPEN THE EDITOR OVER THE NUMBER.
 *
 *   object    the dimension being edited (for its anchor and its type)
 *   value     the text currently shown
 *   world     the number's position in drawing units
 *   state     the live drawing state, for the camera
 *   onApply   receives the typed string; returns `{ ok: false, error }` to keep
 *             the field open with that reason
 *   onCancel  called when the student abandons the edit
 */
export function openDimensionTextEditor({
  object,
  value = "",
  world = null,
  state = null,
  onApply,
  onCancel,
  submitOn = "enter",
} = {}) {
  closeOpen();

  if (!globalThis.document?.createElement) {
    return null;
  }

  const canvas = enggInlineEntry.canvasElement();
  const host = globalThis.document.createElement("div");
  host.className = "drawing-canvas-text-editor drawing-dimension-text-editor";
  host.dataset.inline = "true";
  host.dataset.dimensionId = object?.id || "";
  host.setAttribute("role", "group");
  host.setAttribute(
    "aria-label",
    object?.dimensionType === "angular"
      ? "Edit angle label"
      : "Edit dimension label",
  );

  const input = globalThis.document.createElement("input");
  input.type = "text";
  input.className = "drawing-dimension-text-field";
  input.setAttribute("aria-label", "Dimension text");
  input.spellcheck = false;
  input.autocomplete = "off";
  input.value = String(value ?? "");
  host.append(input);

  (canvas || globalThis.document.body).append(host);

  let finished = false;

  /*
   * A PRESS ELSEWHERE COMMITS, LIKE EVERY OTHER IN-PAGE FIELD. Escape is the way
   * to abandon an edit, so a stray click can never silently lose typed text.
   * Declared here so the closer below can always take it off the document again.
   */
  const outside = (event) => {
    if (!finished && !host.contains(event.target)) {
      finish();
    }
  };

  /*
   * ONE CLOSER, WHICH ALWAYS TAKES ITS LISTENER WITH IT - so a second field
   * never leaves a listener behind on the document.
   */
  const close = () => {
    host.remove();
    globalThis.document.removeEventListener("pointerdown", outside, true);

    if (closeCurrent === close) {
      closeCurrent = null;
    }
  };

  closeCurrent = close;

  const place = () => {
    const box = enggInlineEntry.canvasBounds(
      canvas || enggInlineEntry.canvasElement(),
    );
    const anchor =
      world || enggInlineEntry.modelPointForTextEntry(object) || null;

    if (!anchor) {
      return;
    }

    /*
     * THE EDITOR'S TYPE IS THE LABEL'S OWN CANVAS SIZE.
     *
     * `noteTextStyle` answers the line spacing and alignment the label is laid
     * out with, and the field takes its own `font` from the same shared size
     * rules the canvas paints by - so the box a student types into is the box the
     * words will occupy, at every zoom.
     */
    const typography = noteTextStyle({
      ...(object?.style || {}),
    });

    /*
     * THE FIELD IS EXACTLY AS LARGE AS THE LABEL UNDER IT.
     *
     * The canvas draws the number at a SCREEN font size - `style.fontSize`, from
     * the shared typography system - and cancels the camera on the glyphs, so
     * the number measures the same at every zoom. The field is a DOM box over
     * that canvas, so it takes that same screen size directly: no zoom is
     * multiplied in, and typed text appears at the size of the text it replaces
     * at 25% and at 400% alike.
     */
    const font = fontSizeOf(
      Number(object?.style?.fontSize),
      SECONDARY_FONT_PX,
    ); 

    const origin = enggInlineEntry.worldToClient(anchor, {
      state,
      bounds: box,
    });

    const width = Math.max(
      90,
      noteTextWidth(input.value || " ", typography, font) + 18,
    );
    const height = Math.max(font * 1.6, font * typography.lineSpacing + 10);

    /*
     * CENTRED ON THE NUMBER. The drawing's text is centred on its frame, so the
     * field is centred on the same point - typed text appears exactly where the
     * old text was rather than shifting left as it is written.
     */
    const inside =
      box &&
      origin.x >= box.rect.left &&
      origin.x <= box.rect.right &&
      origin.y >= box.rect.top &&
      origin.y <= box.rect.bottom;

    if (box && inside) {
      host.style.left = `${origin.x - box.rect.left - width / 2}px`;
      host.style.top = `${origin.y - box.rect.top - height / 2}px`;
    } else {
      /* The number is scrolled out of view: keep the field on the canvas. */
      host.style.left = `${Math.max(4, (box?.width || 240) / 2 - width / 2)}px`;
      host.style.top = `${Math.max(4, (box?.height || 160) / 2 - height / 2)}px`;
    }

    host.style.width = `${width}px`;
    host.style.height = `${height}px`;
    input.style.fontSize = `${font}px`;
    input.style.fontFamily = typography.fontFamily;
    input.style.fontWeight = typography.bold ? "bold" : "normal";
    input.style.fontStyle = typography.italic ? "italic" : "normal";
    input.style.textAlign = "center";
    input.style.color = /^#[0-9a-f]{6}$/i.test(
      String(object?.style?.stroke || ""),
    )
      ? object.style.stroke
      : "inherit";
  };

  const finish = (cancel = false) => {
    if (finished) {
      return;
    }

    finished = true;

    if (cancel) {
      close();
      onCancel?.();
      return;
    }

    const text = input.value;

    const result = onApply?.(text);

    if (result && result.ok === false) {
      /*
       * THE FIELD STAYS OPEN WITH ITS OWN REASON. A value the dimension cannot
       * accept is not a commit, and closing the editor would leave the student
       * looking at the old number with no idea why theirs was refused.
       */
      finished = false;
      input.focus();
      input.select();
      return;
    }

    close();
  };

  input.addEventListener("keydown", (event) => {
    event.stopPropagation();

    if (event.key === "Escape") {
      event.preventDefault();
      finish(true);
      return;
    }

    if (event.key === "Enter" && submitOn !== "ctrl") {
      event.preventDefault();
      finish();
      return;
    }

    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      finish();
    }
  });

  input.addEventListener("input", place);

  host.addEventListener("keydown", (event) => event.stopPropagation());
  host.addEventListener("keyup", (event) => event.stopPropagation());
  host.addEventListener("pointerdown", (event) => event.stopPropagation());

  globalThis.document.addEventListener("pointerdown", outside, true);

  place();
  input.focus();
  input.select();

  return host;
}

export const dimensionTextEditor = {
  open: openDimensionTextEditor,
  close: closeOpen,
  isOpen,
};

export default dimensionTextEditor;

import { attachTextSymbols, symbolPickerContains } from "./text-symbol-insert.js";

import {
  AUXILIARY_FONT_PX,
  PRIMARY_FONT_PX,
  SECONDARY_FONT_PX,
  TEXT_ENTRY_BOX_PT,
  textEntryMetricsAt,
} from "../../typography/canvas-typography.js";
import enggDrawingState from "../../model/drawing-state.js";

/*
 * WHERE THE CANVAS PUTS A LINE OF TEXT ABOUT ITS ANCHOR.
 *
 * A canvas `<text>` is drawn with `dominant-baseline: middle` - the shared
 * `CANVAS_BASELINE` - so the anchor point is the VERTICAL MIDDLE of the line,
 * not its baseline. Half an em above it is therefore the top of the text.
 *
 * This is the one figure the editing box needs: an HTML field's `top` is the top
 * of its line box, so seating the words where they will be committed means
 * raising the box by half a font size. It is read from the same constant the
 * renderer uses, so the two cannot drift apart again - which is exactly how the
 * box came to sit a WHOLE font size above its own text.
 */
const HALF_LINE = 0.5;

/*
 * HOW TALL ONE LINE OF THE EDITING FIELD IS, relative to the font size.
 *
 * One line of type needs its ascenders and descenders to fit; it does not need
 * the generous leading a paragraph uses. 0.95 seats a single line snugly in its
 * box - the field reads as one line of words rather than as a panel with text
 * floating in it - while still leaving room for a "g" and a "T" on the same
 * line. Multi-line spacing is the text's own business and is unaffected.
 */
const TIGHT_LINE = 0.95;
/*
 * The Note editor.
 *
 * A Note is the student's own words about the drawing, so it has to be
 * writable. Placing one, or double-clicking it, opens this box; the student
 * types, and the text is handed back as ONE change the caller can commit as
 * one undoable action.
 *
 * ============================================================
 * IT IS AN INLINE PROMPT, NOT A DIALOG
 * ============================================================
 *
 * It used to be a full-screen modal: a translucent white sheet over the whole
 * workspace with the field centred in it. That is the wrong shape for this
 * interaction. The student has just said WHERE the words go, and the modal then
 * covered the thing they were labelling - a beam asked for its label disappeared
 * behind the dialog asking for it.
 *
 * So the editor is a FIELD ON THE DRAWING instead:
 *
 *   - anchored to the node, at the canvas point the text will occupy;
 *   - with the drawing fully visible behind it, nothing dimmed, nothing hidden;
 *   - typing shown at the node as a live preview, in the feature's own colour,
 *     before anything is committed;
 *   - Enter commits, Shift+Enter adds a line, Escape cancels.
 *
 * ============================================================
 * THERE IS NO DIALOG. THERE IS NO POPUP.
 * ============================================================
 *
 * This file used to keep a modal editor as a fallback for a caller with no node
 * to hang on - the box a label or a leader fell through to. That is exactly the
 * inconsistent interface the correction removes: text that appears on the
 * drawing is entered ON the drawing, whoever opened the box. A caller with no
 * position now gets the field at the middle of the canvas, which is where the
 * student is working.
 *
 * EVERY text editor in DAETUM is this one: notes, labels, leaders, callouts,
 * equations, Heat notations, a block's name, an axis name, a dimension's
 * number. One field, one caret, one keyboard, one commit path.
 *
 * A GENERATED annotation is refused one, because its text is a reading of
 * its feature and a next redraw would overwrite anything typed - the
 * caller guards for that before opening this.
 */

import enggInlineEntry from "./inline-text-entry.js";

let openDialog = null;

let closeCurrent = null;

/* The camera watcher attached to the current prompt, if any. */
let stopFollowing = null;

/* The document listener that commits an entry when the student clicks away. */
let stopOutsidePress = null;

function close() {
  if (stopFollowing) {
    try {
      stopFollowing();
    } catch {
      /* A stubbed subscription in a test must not stop the close. */
    }

    stopFollowing = null;
  }

  if (openDialog) {
    openDialog.remove();
    openDialog = null;
  }

  closeCurrent = null;

  /*
   * REMOVING AN ELEMENT DOES NOT DROP THE LISTENERS THE DOCUMENT HOLDS. The
   * outside-press listener is registered by the prompt and must be taken back
   * whenever the prompt goes - by any route: commit, Escape, or a second
   * `open()` replacing it. Otherwise a closed prompt would still react to a
   * press and apply text nobody is looking at.
   */
  if (stopOutsidePress) {
    stopOutsidePress();
    stopOutsidePress = null;
  }
}

function isOpen() {
  return openDialog !== null;
}

/* Whether the open prompt is the on-canvas one - which it always is now. */
function isInline() {
  return Boolean(openDialog && openDialog.dataset.inline === "true");
}

/*
 * Escape reaches this dialog the same way it reaches the dimension
 * editor: the global handler asks every open dialog whether it wants the
 * key, and the first one that does swallows it.
 */
function handleEscape() {
  if (!openDialog) {
    return false;
  }

  closeCurrent?.();

  return true;
}

/*
 * THE FIELD, IN BOTH SHAPES.
 *
 * A SINGLE-LINE BOX IS AN INPUT; A MULTI-LINE ONE IS A TEXTAREA. The field's
 * own key handling is then the keyboard's standard behaviour plus the one
 * commit key, which is what makes Enter "commit" here and "new line" there.
 */
function fieldMarkup(multiline, placeholder, value, extraClass = "") {
  const classes = ["drawing-property-input", extraClass]
    .filter(Boolean)
    .join(" ");

  return multiline
    ? `<textarea id="noteText"
            class="${classes} drawing-note-dialog-text"
            rows="2"
            spellcheck="false"
            placeholder="${escapeHtml(placeholder)}"
            aria-label="${escapeHtml(placeholder)}">${escapeHtml(
              value ?? "",
            )}</textarea>`
    : `<input id="noteText"
            type="text"
            class="${classes}"
            spellcheck="false"
            placeholder="${escapeHtml(placeholder)}"
            aria-label="${escapeHtml(placeholder)}"
            value="${escapeHtml(value ?? "")}">`;
}

/*
 * ============================================================
 * ONE KEYBOARD FOR EVERY CANVAS TEXT FIELD
 * ============================================================
 *
 *   Enter         commit the text and finish editing
 *   Shift+Enter   insert a line and stay editing
 *   Escape        cancel, per the field's own cancellation rule
 *
 * THE SAME THREE KEYS EVERYWHERE, multiline or not. A note is prose and a label
 * is usually one word, but both are text on the same sheet and both are edited
 * in the same box - so the key a student presses between sentences must not mean
 * two different things depending on which tool they used.
 *
 * Ctrl+Enter (Cmd+Enter on a Mac) also commits, because it did before and a
 * habit is not worth breaking.
 *
 * THE PROMPT OWNS THE KEYBOARD WHILE IT IS OPEN. The canvas's global shortcut
 * handler already treats a keystroke that starts in a text field as typing, so
 * drawing shortcuts cannot fire; swallowing propagation here is for the other
 * direction - an ancestor or a tool listener must not act on a key the field
 * is using. A pointer press in the field likewise never reaches the canvas.
 */
function attachKeyHandling(host, { apply, cancel }) {
  host.addEventListener("keydown", (event) => {
    event.stopPropagation?.();

    if (event.key === "Escape") {
      event.preventDefault();
      cancel();
      return;
    }

    if (event.key !== "Enter") {
      return;
    }

    /*
     * SHIFT+ENTER IS A NEW LINE, AND ONLY A NEW LINE. The field inserts it
     * itself; returning here is what stops it from also being read as a commit.
     */
    if (event.shiftKey) {
      return;
    }

    event.preventDefault();
    apply();
  });

  host.addEventListener("pointerdown", (event) => {
    event.stopPropagation?.();
  });
}

/*
 * THE CARET GOES AFTER THE EXISTING CONTENT, not in front of it: reopening a
 * written annotation to add to it should not begin by typing over its first
 * word.
 */
function focusField(input) {
  if (!input) {
    return;
  }

  try {
    input.focus({ preventScroll: true });
  } catch {
    input.focus?.();
  }

  input.setSelectionRange?.(input.value.length, input.value.length);
}

/*
 * A LABEL FIELD OPENS EMPTY, so its caret goes AT THE START of the box rather
 * than after the end of the text - an empty field has no end to sit after, and
 * an empty value opens with the caret already where the first character goes.
 */
function focusFieldForInput(input, empty) {
  focusField(input);

  if (empty) {
    input?.setSelectionRange?.(0, 0);
  }
}

/*
 * POSITION THE PROMPT BESIDE THE ANCHOR.
 *
 * The prompt opens BELOW-RIGHT of the node when that fits, because the drawing
 * itself is at the node and must stay visible: the box hangs off it rather than
 * sitting on it. When there is no room below, above is used, and in either case
 * the box is kept fully inside the window - including the area behind an open
 * inspector, so a node near the canvas's right edge does not put its prompt
 * under the panel.
 *
 * NONE OF THIS MOVES THE NODE. The prompt is a view of the drawing; the drawing
 * does not know it exists.
 */
const PROMPT_GAP = 6;

function canPlace(element) {
  return (
    element &&
    typeof element.getBoundingClientRect === "function" &&
    element.getBoundingClientRect().width > 0
  );
}

/*
 * THE BOTTOM OF THE SHEET, in window pixels.
 *
 * A prompt must stay on the drawing, so the canvas's own lower edge is the
 * boundary when there is one - and the window's otherwise.
 */
function canvasBottom() {
  const canvas = enggInlineEntry.canvasElement();
  const rect = canvas && typeof canvas.getBoundingClientRect === "function"
    ? canvas.getBoundingClientRect()
    : null;

  const bottom = Number(rect?.bottom);

  return Number.isFinite(bottom) && bottom > 0
    ? bottom
    : Number(globalThis.window?.innerHeight) || 0;
}

function visibleRight() {
  /*
   * THE INSPECTOR IS PART OF THE WINDOW as far as the prompt is concerned - a
   * prompt sliding underneath it is off screen in every way that matters.
   */
  const panel = globalThis.document?.querySelector?.(
    ".drawing-panel, .drawing-features-panel, .drawing-source-panel",
  );

  const viewport = Number(globalThis.window?.innerWidth) || 0;

  if (canPlace(panel)) {
    const rect = panel.getBoundingClientRect();

    /* Only a panel on the right-hand side shortens the usable width. */
    if (rect.left > viewport / 2) {
      return rect.left;
    }
  }

  return viewport;
}

function placePrompt(host, rect) {
  const size = {
    width: host.offsetWidth || 240,
    height: host.offsetHeight || 44,
  };

  const margin = 6;
  const width = Number(globalThis.window?.innerWidth) || size.width + margin * 2;
  const height = Number(globalThis.window?.innerHeight) || size.height + margin * 2;

  const right = Math.min(visibleRight(), width) - margin;
  const bottom = Math.min(height, canvasBottom()) - margin;

  const nodeX = Number(rect.left) || 0;
  const nodeY = Number(rect.top) || 0;

  /*
   * BELOW-RIGHT WHEN IT FITS; OTHERWISE ABOVE, THEN PULLED INTO THE WINDOW.
   *
   * "FITS" IS MEASURED AGAINST THE CANVAS'S BOTTOM TOO. A prompt hung below a
   * node near the sheet's edge is off the drawing - it looks like the click did
   * nothing - even though the window continues. So the field goes above the node
   * as soon as the space below it is not on the sheet.
   */
  /*
   * THE HEIGHT THE FIELD WILL OCCUPY, not the one it currently reports. A
   * field that has just been created measures zero in some environments (an
   * unlaid-out page, a headless document), which made every prompt believe it
   * fitted below its node - so a node at the bottom of the sheet got a field
   * under it. One line of type is the honest floor.
   */
  const heightNeeded = Math.max(size.height, 44);

  let top =
    nodeY + PROMPT_GAP + heightNeeded <= bottom
      ? nodeY + PROMPT_GAP
      : nodeY - PROMPT_GAP - heightNeeded;

  let left = nodeX + PROMPT_GAP;

  if (left + size.width > right) {
    left = Math.min(nodeX - PROMPT_GAP - size.width, right - size.width);
  }

  left = Math.max(margin, Math.min(left, right - size.width));
  top = Math.max(margin, Math.min(top, bottom - size.height));

  host.style.left = `${Math.round(left)}px`;
  host.style.top = `${Math.round(top)}px`;
  host.dataset.side = top < nodeY ? "above" : "below";
}

/*
 * THE LIVE PREVIEW.
 *
 * A second, tiny fixed-position element at the node's own place. It carries the
 * words the student has typed, so the drawing's appearance is previewed where
 * it will be - and the prompt can sit just above it without covering it.
 *
 * IT IS NEVER STORED. Cancelling throws it away with the prompt; nothing is
 * written into the feature until the entry is committed.
 */
function createPreview(object) {
  const element = document.createElement("div");

  element.className = "drawing-inline-entry-preview";
  element.setAttribute("aria-hidden", "true");

  const style = object?.style || {};

  element.style.color = style.stroke || "";
  element.style.fontSize = "12px";

  let text = String(object?.text ?? "");

  function render() {
    element.textContent = text;
    element.hidden = !text.trim();
  }

  render();

  return {
    element,
    setText(value) {
      text = String(value ?? "");
      render();
    },
    place(rect) {
      if (!rect) {
        return;
      }

      element.style.left = `${rect.left ?? rect.x}px`;
      element.style.top = `${rect.bottom ?? rect.y}px`;
    },
  };
}

/*
 * THE ON-DRAWING LABEL FIELD.
 *
 * A label prompt is not a form. It is the words, being typed, where they will
 * be drawn - so this presentation has no title, no hint, no border card and no
 * background. It is a single transparent line of text at the object's own label
 * anchor, in the object's own colour and size, with the caret as the only sign
 * that it is editable. It grows as it is typed and never covers the object it
 * belongs to.
 *
 * The SAME field, the SAME keys and the SAME commit path as every other inline
 * prompt - only the chrome differs - so there is one text-entry implementation.
 */
function openLabelField(options, anchor) {
  const host = document.createElement("div");

  host.className = "drawing-inline-entry drawing-label-entry";
  host.dataset.inline = "true";
  host.setAttribute("role", "group");
  host.setAttribute("aria-label", "Label");

  host.dataset.empty = String(!String(options.text ?? "").length);

  if (options.placeBeside === true) {
    host.classList.add("drawing-label-entry-beside");
  }

  /*
   * A LABEL FIELD IS MULTILINE, like the words it stands for.
   *
   * A note, a label and an equation can all be more than one line, and the
   * drawing honours the line breaks. The field is therefore a TEXTAREA in every
   * case: Shift+Enter adds a line and Enter commits (see the key handling
   * below), so the one text-entry box in DAETUM has one keyboard everywhere.
   */
  host.innerHTML = fieldMarkup(
    true,
    "",
    options.text ?? "",
    "drawing-label-entry-input",
  );

  /*
   * THE FIELD IS A CHILD OF THE DRAWING SPACE WHEN IT SITS ON THE SHEET.
   *
   * The anchor a caller passes may be a WINDOW point (the editor places the box
   * with `position: fixed`) or a point inside the canvas (the viewport has
   * already projected the drawing position). The second is the on-the-drawing
   * case, and there the field belongs INSIDE the canvas element: it is part of
   * the sheet, it is clipped by it rather than floating over the panels, and its
   * coordinates are the canvas's own.
   *
   * A CENTRE ANCHOR IS A CANVAS ANCHOR TOO. A caller with no position at all - 
   * a note opened from the Objects list, a tool that has only just placed its
   * object - is given the canvas's middle (`canvasCentreAnchor`), and that point
   * is already in the canvas's own frame. Mounting it on the body put the field
   * at `canvas.top` down the WINDOW instead of on the sheet, because the frame
   * it was measured in and the frame it was placed in were not the same one.
   * `centre` says which anchor that is, so the two agree by construction.
   */
  /*
   * THE DRAWING THE BOX IS SIZED AGAINST.
   *
   * The camera the caller opened the field with, when it passes one - the same
   * `camera` its anchor was projected through - and otherwise the live sheet's.
   * Sizing from the camera the anchor was placed with is what keeps the box and
   * the words in one frame: a field opened for a saved viewport, or by a test,
   * is still the defined size at that viewport's zoom.
   */
  const drawingState = globalThis.enggDrawingState || null;

  const activeCamera = () =>
    options.camera && Number.isFinite(Number(options.camera.zoom))
      ? options.camera
      : drawingState?.camera || {};

  const pixelsPerUnit = () =>
    Number(enggDrawingState.BASE_PIXELS_PER_UNIT || 2.4) *
    (Number(activeCamera().zoom) || 1);

  void drawingState;

  /*
   * THE BOX IS SIZED FROM THE DRAWING, BEFORE IT IS PLACED.
   *
   * A field that has just been created is empty, so it opens at the full 200 pt;
   * one reopened on a written label opens at that label's width. Both are
   * measured in the drawing's own units (see `TEXT_ENTRY_BOX`), so the box is
   * the size of the note it is writing rather than a panel of its own.
   *
   * The values are written ONCE, here, and `place` only reads them back - so
   * what the box is and where its edges go can never be two different answers.
   */
  const writeBoxMetrics = (text) => {
    const metrics = textEntryMetricsAt(pixelsPerUnit(), text ?? "");

    host.style.setProperty("--entry-box-width", `${metrics.widthPx}px`);
    host.style.setProperty("--entry-box-height", `${metrics.heightPx}px`);
    host.style.setProperty("--entry-box-min-width", `${metrics.minWidthPx}px`);
    host.style.setProperty("--entry-padding-x", `${metrics.paddingXPx}px`);
    host.style.setProperty("--entry-padding-y", `${metrics.paddingYPx}px`);

    return metrics;
  };

  /*
   * THE BOX IS PART OF THE SHEET, SO IT IS MOUNTED ON THE SHEET.
   *
   * Its dimensions come from the drawing and are scaled by the camera, so the
   * canvas's own frame is the frame it belongs in: its `left`/`top` are drawing
   * pixels, it is clipped by the sheet rather than floating over the panels, and
   * a resized sidebar or a panned view needs no second set of rules for it.
   *
   * A page-level mount is only the answer when there is no canvas at all - a
   * blank page, a test harness without the application's markup.
   */
  const canvasHost = enggInlineEntry.canvasElement();
  const onCanvas = Boolean(canvasHost);

  if (onCanvas) {
    host.classList.add("drawing-label-entry-on-canvas");
    canvasHost.appendChild(host);
  } else {
    document.body.appendChild(host);
  }

  /* Reported once, so a wrong mount is visible rather than a mystery. */
  host.dataset.mountedOn = onCanvas ? "canvas" : "body";

  openDialog = host;

  const input = host.querySelector("#noteText");
  attachTextSymbols(host);

  const style = options.object?.style || {};
  const stroke = /^#[0-9a-f]{6}$/i.test(String(style.stroke || ""))
    ? style.stroke
    : "var(--datum-ink)";

  input.style.color = stroke;
  input.style.caretColor = stroke;

  if (options.labelField === true) {
    input.placeholder = "";
    input.style.background = "transparent";
  }

  /*
   * AN EMPTY LABEL FIELD SHOWS ITS OWN BOX.
   *
   * A field that already holds words IS its box - the underline reaches as far
   * as the text. An EMPTY one underlines nothing, which looks like nothing was
   * opened at all, so while it is empty it carries a faint outline at the size
   * of its typing area. The outline goes the moment a character is typed; the
   * field is closed by then in the usual case, and the drawing is left with no
   * box in it either way.
   */
  if (options.labelField === true) {
    const mark = () => {
      host.dataset.empty = String(!input.value.length);
    };

    input.addEventListener("input", mark);

    mark();
  }

  /*
   * THE BOX IS THE DRAWING'S OWN, EVERY TIME IT IS PLACED.
   *
   * Written before anything is measured or positioned, so a camera change
   * re-sizes it along with re-placing it - the zoom moves the box and the words
   * through the same scale, which is what keeps it the size of the note it is
   * writing at every magnification.
   */
  const writeBox = () => writeBoxMetrics(input?.value ?? "");

  writeBox();

  const place = () => {
    const rect =
      typeof options.anchor === "function" ? options.anchor() : anchor;

    if (!rect) {
      return;
    }

    void host.dataset.mountedOn;

    /*
     * AT THE ANCHOR, NOT BESIDE IT. The prompt sits exactly where the drawn
     * label will sit, so the words do not jump when it is committed; it is
     * nudged only enough to keep a caret's width clear of the point it names.
     */
    /*
     * THE FIELD'S OWN DIMENSIONS, FROM THE DRAWING.
     *
     * See `TEXT_ENTRY_BOX` in `canvas-typography.js`: 200x36 pt at 14 pt type
     * with 8/4 pt padding, boxed and scaled through the camera. Nothing here
     * states a pixel size of its own - the box is the drawing's, so it is the
     * size of the note it is writing at every zoom, and the source states the
     * identical figures.
     */
    const metrics = writeBoxMetrics(input?.value ?? "");

    host.style.fontSize = `${metrics.fontSizePx}px`;
    input.style.fontSize = `${metrics.fontSizePx}px`;
    input.style.lineHeight = `${metrics.lineHeightPx}px`;

    /*
     * BESIDE THE ANCHOR, WHEN THE CALLER ASKS FOR IT.
     *
     * A label is written where it will be drawn, so it sits ON its anchor. A
     * VALUE - a force's magnitude at its arrowhead - has no drawn text of its
     * own to sit on, and sitting on the arrowhead would put the field over the
     * arrow it names. So a value is hung just off the anchor, level with it, on
     * the side with room - never over the drawing it belongs to.
     */
    if (options.placeBeside === true) {
      /*
       * THE ANCHOR AND THE WINDOW, IN THE FRAME THE FIELD IS IN.
       *
       * A field mounted on the canvas is positioned in the CANVAS's own box, so
       * both the anchor and the edges it must stay inside are the canvas's. A
       * field on the page is positioned in the window's, so they are the
       * window's. Reading one frame and writing the other is how a prompt ended
       * up off the bottom of the sheet.
       */
      const frame = rect.frame === "canvas" ? canvasSize() : windowSize();

      /* The field is a child of the canvas, so its frame is the canvas's. */
      const origin = canvasOrigin();

      const nodeX = (Number(rect.left) || 0) - origin.left;
      const nodeY = (Number(rect.top) || 0) - origin.top;

      const width = host.offsetWidth || 120;
      const height = host.offsetHeight || metrics.heightPx;
      const gap = Math.max(8, Math.round(metrics.fontSizePx * 0.9));

      const margin = 6;
      const windowWidth = frame.width;
      const windowHeight = frame.height;
      const right = Math.min(visibleRight(), windowWidth) - margin;
      const bottom = windowHeight - margin;

      /* To the RIGHT of the anchor when the value fits there, otherwise LEFT. */
      let left =
        nodeX + gap + width <= right
          ? nodeX + gap
          : nodeX - gap - width;

      /* CENTRED on the anchor's line, so it reads as belonging to that point. */
      let top = nodeY - height / 2;

      left = Math.max(margin, Math.min(left, right - width));
      top = Math.max(margin, Math.min(top, bottom - height));

      host.style.left = `${Math.round(left)}px`;
      host.style.top = `${Math.round(top)}px`;
      host.dataset.side = left < nodeX ? "left" : "right";

      return;
    }

    /*
     * THE TYPE IS THE BOX'S OWN, FROM THE DEFINITION.
     *
     * `TEXT_ENTRY_BOX` states 14 pt of type in a 36 pt box, and `writeBoxMetrics`
     * above has already put that on the field. The old code took a size from the
     * CALLER (or from the object's role) and wrote it over the definition, which
     * is how two text tools ended up with differently sized fields on one sheet.
     * One definition, so every text tool's field is the same field.
     *
     * The line is stated as the box's own advance, so a single line is exactly
     * one line tall and sits centred in the 36 pt.
     */
    input.style.lineHeight = `${metrics.lineHeightPx}px`;
    input.style.fontFamily = options.object?.style?.fontFamily || "inherit";
    input.style.textAlign =
      options.object?.style?.align === "center"
        ? "center"
        : options.object?.style?.align === "right"
          ? "right"
          : "left";



    /*
     * THE FIELD SITS EXACTLY WHERE THE WORDS WILL BE DRAWN.
     *
     * The anchor is a point in the drawing; the committed label is drawn with
     * `dominant-baseline: middle`, so that point is the vertical MIDDLE of its
     * first line. This box used to be nudged four pixels right and lifted a
     * WHOLE font size - so the words visibly jumped left and down the instant
     * they were committed.
     *
     * There is no nudge now. The box's left edge is the anchor's x, and its top
     * is the anchor raised by half a line, which is where the top of the text
     * really is.
     */
    /*
     * THE BOX GROWS BOTH WAYS FROM THE INSERTION POINT.
     *
     * It is centred on the anchor's x - the point the caret occupies - so a
     * wider box opens out to the left and to the right rather than dragging the
     * words away from where they will be committed. Vertically it is centred on
     * the anchor's y, which is the MIDDLE of the drawn line (`dominant-baseline:
     * middle`), so the text sits on the box's own centre line.
     *
     * The box never moves the drawing: only where the FIELD is drawn changes.
     */
    const boxWidth = Number.parseFloat(host.style.getPropertyValue("--entry-box-width")) || 0;
    const boxHeight = Number.parseFloat(host.style.getPropertyValue("--entry-box-height")) || 0;

    /*
     * THE ANCHOR, AND WHICH FRAME IT IS IN.
     *
     * `resolveTextEntryAnchor` projects the point through the canvas's own box
     * and marks the rect `frame: "canvas"`, which is why the field is mounted ON
     * the canvas. Subtracting the canvas's window origin from a point that is
     * already canvas-local - which is what this used to do unconditionally -
     * moved the box by a whole canvas away from its own caret.
     */
    const worldLeft = Number(rect.left) || 0;
    const worldTop = Number(rect.top) || 0;

    /*
     * A RECT THAT HAS BEEN PROJECTED FOR THE SHEET IS ALREADY LOCAL.
     *
     * The field is a child of the canvas in every case, so a window-side point
     * would be a different frame - and the two must never be confused, which is
     * what put a box a whole canvas away from its own caret. So the RECT is
     * taken as the canvas-local point it should be: the editor projects the
     * caller's anchor itself, through the canvas's box, for exactly this.
     */
    const local = localAnchorFor(rect, options);

    const left = local.x;
    const top = local.y;

    host.style.left = `${Math.round(left - boxWidth / 2)}px`;
    host.style.top = `${Math.round(top - boxHeight / 2)}px`;
  };

  options.place = place;

  /*
   * THE BOX IS ONE LINE TALL, AND GROWS ONLY WHEN THE TEXT NEEDS IT.
   *
   * A single line is the DEFINED 36 pt: the field is exactly that tall, centred
   * on the text's own line, and typing into it does not change its height. A
   * line break - Shift+Enter, or a label that already holds several lines - adds
   * one line box per extra line, and nothing else; the width is unaffected by
   * how many lines there are.
   *
   * This used to measure `scrollHeight` on every keystroke, which made a
   * single-line box a pixel or two taller than the next one depending on the
   * glyphs in it. The height is now the DEFINITION rather than the field's own
   * contents.
   */
  const autosize = () => {
    const lines = Math.max(1, String(input?.value ?? "").split("\n").length);

    const metrics = textEntryMetricsAt(pixelsPerUnit(), input?.value ?? "");
    const height = lines === 1
      ? metrics.heightPx
      : metrics.paddingYPx * 2 + lines * metrics.lineHeightPx;

    host.style.setProperty("--entry-box-height", `${height}px`);

    if (typeof place === "function") {
      place();
    }
  };

  /*
   * THE BOX IS AS WIDE AS THE LINE IN IT - MEASURED, NOT COUNTED.
   *
   * A canvas element, with the field's own font applied, measures the exact
   * advance width of the string, so the box is the width of the words rather
   * than an estimate of them. Without a measurable canvas (a test, a DOM with no
   * canvas) the shared estimate gives the box a size, and the field still opens.
   */
  const measurement = globalThis.document?.createElement?.("canvas") || null;

  const textWidthOf = (text, style) => {
    if (!measurement) {
      return 0;
    }

    /*
     * A DOCUMENT WITH NO 2D CONTEXT STILL HAS TO OPEN A FIELD.
     *
     * `getContext` does not merely RETURN null where canvas is not
     * implemented - jsdom, and any DOM without the canvas package, THROW
     * "Not implemented" - and that exception used to escape from here into
     * `openInline`, so the whole text field never opened: the note tool placed
     * its object and the student had nothing to type into.
     *
     * A measurement that cannot be taken is the same news as a context that is
     * null: no advance width is known, and the caller's caret-room floor gives
     * the box a size. The field opening is worth more than an exact width.
     */
    let context = null;

    try {
      context = measurement.getContext?.("2d") || null;
    } catch {
      return 0;
    }

    if (!context) {
      return 0;
    }

    context.font = `${style.fontWeight} ${style.fontStyle} ${style.fontSize} ${style.fontFamily}`;

    return context.measureText(text).width;
  };

  /*
   * THE WIDTH, RE-MEASURED FROM THE TEXT AS IT IS TYPED.
   *
   * The measured advance replaces the estimate the shared metric uses, so the
   * box is the width of the words to the pixel - between the 120 pt floor and
   * the 200 pt standard box. It is the LINE's width, not the longest line's: a
   * box that widened to fit a long line and never narrowed again would leave a
   * paragraph's field permanently as wide as its opening sentence.
   */
  const sizeToContent = () => {
    const value = input?.value ?? "";

    /*
     * THE DEFINED BOX IS PUT IN PLACE FIRST. Everything below refines it from
     * the text; the definition is what a field with nothing to measure keeps.
     */
    const metrics = writeBoxMetrics(value);

    /*
     * AN EMPTY FIELD KEEPS THE FULL 200 pt. Nothing has been typed, so there is
     * no line to fit, and the standard box is what it opens at.
     */
    if (!value.length) {
      return;
    }

    const computed = globalThis.getComputedStyle?.(input) || null;

    const firstLine = value.split("\n")[0];

    const measured = textWidthOf(firstLine, computed || {
      fontSize: "14px",
      fontFamily: "Arial, sans-serif",
      fontWeight: "400",
      fontStyle: "normal",
    });

    /*
     * THE LINE'S OWN WIDTH, PLUS THE BOX'S PADDING ON BOTH SIDES AND ONE
     * CARET'S ROOM - never below the 120 pt floor, and never beyond the 200 pt
     * standard box. Where no width can be measured (a DOM with no canvas) the
     * shared estimate already on `metrics` is used, so the field still fits the
     * text it holds.
     */
    const caret = metrics.fontSizePx * 0.62;

    const content = measured > 0
      ? measured + metrics.paddingXPx * 2 + caret
      : metrics.widthPx;

    /*
     * THE BOX GROWS ACROSS THE LINE, WITHIN ITS OWN LIMITS. The floor is the
     * 120 pt minimum; there is no ceiling but the standard 200 pt box, which is
     * the widest the definition allows a single line of text to make it.
     */
    const width = Math.max(metrics.minWidthPx, Math.min(content, metrics.widthPx));

    host.style.setProperty("--entry-box-width", `${Math.ceil(width)}px`);
  };

  input.addEventListener("input", () => {
    sizeToContent();
    autosize();
  });

  sizeToContent();
  autosize();

  /*
   * THE FIELD'S OWN PLACE, PUT BACK ONTO THE CALLER'S OPTIONS.
   *
   * Every other inline presentation publishes its `place` so a camera change can
   * move it; this one did not, so `openLabelFlow` followed the camera with
   * nothing - and a field that cannot be re-placed also cannot autosize. It is
   * the same contract as `openInline`, kept identical so there is one way a
   * prompt follows its node.
   */
  options.place = place;
  options.autosize = autosize;

  return place;
}

/*
 * THE LABEL FLOOR.
 *
 * It shares every rule of an inline entry - commit on Enter, cancel on Escape,
 * commit on a press elsewhere, no symbol button of its own - and differs only
 * in how it LOOKS and where it sits. The preview is suppressed: the words are
 * already the field.
 */
function openLabelFlow(options, anchor) {
  const place = openLabelField(options, anchor);
  const input = openDialog.querySelector("#noteText");

  /*
   * WHAT IS TYPED IS SHOWN WHILE IT IS TYPED.
   *
   * The field IS the words, so there is no separate preview element - but a
   * caller that redraws the sheet from the input (a note's text is the object's
   * own `text`) needs to be told. This is the one place that callback is wired,
   * so every label-shaped field reports its typing the same way.
   */
  if (typeof options.onInput === "function" && input) {
    input.addEventListener("input", () => options.onInput(input.value));
  }

  /*
   * THE FIELD GOES AWAY BEFORE ITS ANSWER IS APPLIED.
   *
   * The caller's `onApply` frequently OPENS THE NEXT FIELD - a vector's name
   * follows its magnitude, a force's name follows its value - and `close()`
   * removes whatever `openDialog` currently holds. Applying first meant that
   * close took down the field the answer had just opened, not this one: the
   * name prompt vanished the instant it appeared, and every chained prompt
   * broke behind a commit that had already succeeded.
   *
   * `text` is read up front, so closing first cannot lose what was typed. A
   * REFUSED answer still keeps the field open - nothing has been closed yet,
   * and the reason is left on screen for the student to correct.
   */
  const apply = () => {
    const text = input ? input.value : "";

    const refused = options.onApply?.(text);

    /*
     * A REFUSED ANSWER KEEPS THE FIELD OPEN - the answer is not taken, so
     * there is nothing to close and the reason stays on screen.
     */
    if (refused && refused.ok === false) {
      input?.focus?.();

      return false;
    }

    /*
     * CLOSE BEFORE APPLYING THE ANSWER. The caller's `onApply` frequently
     * OPENS THE NEXT FIELD - a vector's name follows its magnitude - and
     * `close()` removes whatever `openDialog` holds at the moment it runs.
     * Applying first meant that close took down the field the answer had just
     * opened, not this one, so every chained prompt died behind a commit that
     * had already succeeded. The text was read up front, so closing first
     * cannot lose what was typed.
     */
    close();

    options.onApply?.(text);

    return true;
  };

  const cancel = () => {
    const text = input ? input.value : "";

    close();

    /*
     * A CANCELLED, NEVER-WRITTEN TEXT OBJECT IS REMOVED.
     *
     * A tool creates its annotation EMPTY and commits it before the box opens,
     * so Escape on an untouched field would leave an invisible object on the
     * sheet. The caller says whether this entry was the object's first (by
     * passing `startedEmpty`); if so the cancel still runs, and the tool's own
     * handler takes the object away - which is the behaviour a student expects
     * from "not here after all". An entry that already HELD text never removes
     * anything: Escape restores what was there.
     */
    options.onCancel?.({
      startedEmpty: options.startedEmpty === true && !String(text).trim(),
      text,
    });
  };

  attachKeyHandling(openDialog, { apply, cancel });

  let finished = false;

  const outside = (event) => {
    if (
      finished ||
      openDialog?.contains(event.target) ||
      symbolPickerContains(event.target)
    ) {
      return;
    }

    /*
     * A PRESS ELSEWHERE COMMITS - UNLESS THE FIELD IS EMPTY AND WAS EMPTY WHEN
     * IT OPENED.
     *
     * An empty entry is not text anyone wrote: a note placed and abandoned, or a
     * label opened and left. Cancelling it leaves the sheet as it was. The caller
     * says which case this is (`cancelOnEmptyOutsidePress`), because it is the
     * caller that knows whether the object existed before this entry.
     */
    if (
      options.cancelOnEmptyOutsidePress === true &&
      !String(input?.value ?? "").trim()
    ) {
      finished = true;
      cancel();

      return;
    }

    /*
     * A REFUSED ANSWER LEAVES THE FIELD UP AND STILL LISTENING. Latching
     * `finished` before the answer was known meant a press elsewhere with an
     * unusable value locked the field open for good - it would no longer react
     * to any press at all.
     */
    finished = apply() === true;
  };

  stopOutsidePress = () => {
    globalThis.document.removeEventListener("pointerdown", outside, true);
  };

  globalThis.document.addEventListener("pointerdown", outside, true);

  if (typeof options.cameraSignal === "function") {
    stopFollowing = enggInlineEntry.followCamera(options.cameraSignal, place);
  }

  place();

  /*
   * FOCUS AND SELECTION ARE APPLIED AFTER THE CURRENT GESTURE ENDS.
   *
   * This field is opened from INSIDE a pointerup/click handler, and the browser
   * finishes that gesture by giving focus back to the element the press landed
   * on - the canvas. Focusing here, synchronously, was therefore undone a
   * moment later: the field looked right but the keystrokes went to the canvas,
   * so typing a new notation created a NOTE instead of replacing the label.
   *
   * Deferring to the next task lets the gesture finish first, then takes focus
   * and makes the selection - which is the behaviour the student sees.
   */
  const focusAndSelect = () => {
    focusFieldForInput(input, !String(input?.value ?? "").length);

    /*
     * A FIELD THAT OPENS HOLDING A GENERATED DEFAULT SELECTS ALL OF IT.
     *
     * A Heat Transfer label opens already carrying its notation ("Tâ‚"), and
     * the whole point of opening it is that the student may type to REPLACE
     * that notation. With the caret merely at the end, the first keystroke
     * would APPEND - "Tâ‚2" - instead of replacing. Selecting the whole value
     * makes typing replace it, while Enter leaves it exactly as generated.
     */
    if (options.selectAllOnOpen === true && input) {
      input.setSelectionRange?.(0, input.value.length);
    }
  };

  focusAndSelect();

  /*
   * AND AGAIN ON THE NEXT TASK, when the environment has one. The synchronous
   * call keeps the field usable in a runtime without timers (the tests), and
   * the deferred one wins over the browser handing focus back to the canvas.
   */
  if (typeof globalThis.setTimeout === "function") {
    globalThis.setTimeout(focusAndSelect, 0);
  }

  return openDialog;
}

/*
 * THE INLINE PROMPT.
 *
 *   options.anchor        a DOMRect-like point to hang on (window pixels)
 *   options.object        the feature being written - used for the preview
 *   options.cameraSignal  optional: (listener) => unsubscribe. The prompt then
 *                         follows its node when the student zooms or pans.
 */
function openInline(options, anchor) {
  const multiline = options.multiline !== false;

  if (options.labelField === true) {
    return openLabelFlow(options, anchor);
  }

  const placeholder =
    options.placeholder || (multiline ? "Enter note" : "Enter text");

  const label = options.title || (multiline ? "Edit Note" : "Edit Text");

  const host = document.createElement("div");

  host.className = "drawing-inline-entry";
  host.dataset.inline = "true";

  host.setAttribute("role", "group");
  host.setAttribute("aria-label", label);

  host.innerHTML = `
        <label class="drawing-inline-entry-label"
            for="noteText">${escapeHtml(label)}</label>
        ${fieldMarkup(multiline, placeholder, options.text ?? "", "drawing-inline-entry-input")}
        <span class="drawing-inline-entry-hint"
            aria-hidden="true">${multiline ? "Ctrl+Enter" : "Enter"} &middot; Esc</span>
    `;

  document.body.appendChild(host);

  openDialog = host;

  const input = host.querySelector("#noteText");
  attachTextSymbols(host);

  /*
   * THE DRAWING THE BOX IS SIZED AGAINST - the camera this entry was opened
   * with, or the live sheet's. Defined before the box is written, below.
   */
  const drawingState = globalThis.enggDrawingState || null;

  const activeCamera = () =>
    options.camera && Number.isFinite(Number(options.camera.zoom))
      ? options.camera
      : drawingState?.camera || {};

  const pixelsPerUnit = () =>
    Number(enggDrawingState.BASE_PIXELS_PER_UNIT || 2.4) *
    (Number(activeCamera().zoom) || 1);

  void drawingState;

  const preview = options.object ? createPreview(options.object) : null;

  if (preview && options.preview !== false) {
    host.appendChild(preview.element);
  }

  const place = () => {
    const rect =
      typeof options.anchor === "function" ? options.anchor() : anchor;

    if (!rect) {
      return;
    }

    placePrompt(host, rect);

    preview?.place(rect);
  };

  /*
   * THE SAME DEFINED BOX AS EVERY OTHER TEXT FIELD.
   *
   * A note is entered in the same drawing-sized box as a label: 200 x 36 pt at
   * 14 pt with 8/4 pt of padding (see `TEXT_ENTRY_BOX`). It is stated once here
   * for this prompt too, so the note tool and the label tool cannot open two
   * differently sized boxes for the same kind of text.
   */
  const metrics = textEntryMetricsAt(pixelsPerUnit(), options.text ?? "");

  host.classList.add("drawing-inline-entry-boxed");
  host.style.setProperty("--entry-box-width", `${metrics.widthPx}px`);
  host.style.setProperty("--entry-box-height", `${metrics.heightPx}px`);
  host.style.setProperty("--entry-box-min-width", `${metrics.minWidthPx}px`);
  host.style.setProperty("--entry-padding-x", `${metrics.paddingXPx}px`);
  host.style.setProperty("--entry-padding-y", `${metrics.paddingYPx}px`);
  host.style.fontSize = `${metrics.fontSizePx}px`;

  if (input) {
    input.style.fontSize = `${metrics.fontSizePx}px`;
    input.style.lineHeight = `${metrics.lineHeightPx}px`;
  }

  place();

  const updatePreview = () => {
    preview?.setText(input ? input.value : "");
    place();
  };

  input?.addEventListener("input", updatePreview);

  /*
   * NO FORMATTING UI OVER THE CANVAS, EVER.
   *
   * A floating strip beside the caret looks helpful and is actively in the
   * way: it sits on the words being typed, it reacts to the same keys, and it
   * appears before there is any text to format. Formatting lives in the
   * object's Features tab, where it can be opened deliberately and never
   * covers the drawing.
   *
   * So nothing is opened here. The field, its caret and its own box are the
   * whole editing interface.
   */
  const apply = () => {
    const text = input ? input.value : "";

    close();

    options.onApply?.(text);
  };

  const cancel = () => {
    close();

    options.onCancel?.();
  };

  attachKeyHandling(host, { apply, cancel });

  /*
   * CLICKING ELSEWHERE FINISHES THE ENTRY, THE WAY ANY FIELD ON A CANVAS DOES.
   *
   * A student who has typed a label and then clicks the drawing has finished
   * typing it; leaving a prompt floating over the sheet, still holding their
   * words, looks like the click did nothing. So the field commits on focusout.
   *
   * WHAT COUNTS AS ELSEWHERE IS THE `pointerdown`.
   *
   * `focusout` alone is not enough, and is why this was first written wrong: a
   * canvas click does not MOVE FOCUS (the canvas is not focusable), so the field
   * keeps focus and focusout never fires. A pointer press outside this element
   * does fire, so the press is what is listened for.
   *
   * THE DISCARD IS EXPLICIT. Escape is the way to abandon an entry, and it is
   * already handled on the field - so a stray click cannot silently lose text
   * that the student can still press Escape over.
   *
   * THE GUARD IS `apply` RE-ENTRANCY, because `apply` closes and removes this
   * element: the listener must not run twice for one press.
   */
  let finished = false;

  const outside = (event) => {
    /*
     * A PRESS ON THE FORMATTING STRIP IS NOT "CLICKING ELSEWHERE".
     *
     * The strip is part of the editing surface, so touching it must not commit
     * and close the field - the student is formatting the words they are still
     * writing. Its own controls stop propagation as well, and this is the
     * second guard for a press that lands on its background.
     */
    if (
      finished ||
      host.contains(event.target) ||
      symbolPickerContains(event.target)
    ) {
      return;
    }

    finished = true;

    apply();
  };

  /*
   * THE LISTENER IS REGISTERED ONCE AND REMOVED BY `close()`, whichever way the
   * prompt goes - so a closed prompt can never react to a press, and a second
   * entry never leaves two listeners behind.
   */
  stopOutsidePress = () => {
    globalThis.document.removeEventListener("pointerdown", outside, true);
  };

  globalThis.document.addEventListener("pointerdown", outside, true);

  host.addEventListener("focusout", (event) => {
    if (finished) {
      return;
    }

    /* Focus moving INTO the prompt (label, hint) is still the prompt. */
    if (event.relatedTarget && host.contains(event.relatedTarget)) {
      return;
    }

    /*
     * A FOCUS CHANGE IS NOT COMMITTED UNLESS IT LEAVES THE PAGE. Switching to
     * another window, or the field losing focus to the browser's own chrome,
     * must not silently commit half-typed words; a press elsewhere in the
     * document is the signal, and that is what `outside` handles.
     */
    if (host.contains(event.target) && event.relatedTarget === null) {
      return;
    }
  });

  /* The prompt follows its node when the student zooms or pans behind it. */
  if (typeof options.cameraSignal === "function") {
    stopFollowing = enggInlineEntry.followCamera(options.cameraSignal, place);
  }

  place();
  updatePreview();
  focusField(input);

  return host;
}

/*
 * OPEN THE EDITOR.
 *
 * THE ANCHOR IS RESOLVED FROM THE FEATURE when the caller does not pass one:
 * inline-text-entry.js knows where a note, label, leader or callout writes, and
 * projects it through the live camera. So every caller - the placement
 * workflow, the double-click on the canvas, the Features panel - gets the
 * inline prompt without having to compute anything.
 *
 * `inline: false` no longer asks for a dialog - there is none - it asks for the
 * middle of the canvas, and an object with no resolvable position gets the same
 * place. Text on the drawing is typed on the drawing.
 */
function open(options = {}) {
  if (openDialog) closeCurrent?.();
  close();

  /*
   * `canvasText` IS ACCEPTED AND IGNORED. It used to select a second, separate
   * on-canvas editor; there is now ONE inline field, so a caller asking for
   * "canvas text" gets the same box as every other caller - which is the point
   * of having one editor.
   */

  const explicitAnchor =
    options.anchor && typeof options.anchor !== "function"
      ? options.anchor
      : null;

  /*
   * WHERE THE FIELD GOES.
   *
   * The object's own text position first, then an explicit anchor or point the
   * caller supplied. `inline: false` no longer means "draw a dialog" - there is
   * no dialog any more - it means "use the centre of the canvas", which is what
   * a caller with no position at all is saying: put it where the student is
   * working.
   */
  const resolved =
    (options.object
      ? enggInlineEntry.resolveTextEntryAnchor(options.object, {
          state: options.state,
          camera: options.camera,
          point: options.point,
        })
      : null) ||
    explicitAnchor ||
    canvasCentreAnchor();

  return openInline(options, resolved?.rect || resolved || null);
}

/*
 * THE MIDDLE OF THE DRAWING SPACE, as an anchor.
 *
 * A field with no position to sit on goes where the student is looking rather
 * than into a separate window - so the text is still being written on the
 * drawing, which is the one rule this editor has.
 */
/* The canvas's own box, or the window's when the canvas has not been laid out. */
function canvasSize() {
  const canvas = enggInlineEntry.canvasElement();
  const box = canvas ? enggInlineEntry.canvasBounds(canvas) : null;

  return {
    width: Number(box?.width) || Number(globalThis.window?.innerWidth) || 900,
    height: Number(box?.height) || Number(globalThis.window?.innerHeight) || 600,
  };
}

function windowSize() {
  return {
    width: Number(globalThis.window?.innerWidth) || 900,
    height: Number(globalThis.window?.innerHeight) || 600,
  };
}

/* The canvas's position in the window, or zero when it has none yet. */
function canvasOrigin() {
  const canvas = enggInlineEntry.canvasElement();
  const rect = canvas && typeof canvas.getBoundingClientRect === "function"
    ? canvas.getBoundingClientRect()
    : null;

  return {
    left: Number(rect?.left) || 0,
    top: Number(rect?.top) || 0,
  };
}

function canvasCentreAnchor() {
  const canvas = enggInlineEntry.canvasElement();

  if (!canvas) {
    return null;
  }

  const box = enggInlineEntry.canvasBounds(canvas);

  if (!box) {
    return null;
  }

  /*
   * IN THE CANVAS'S OWN FRAME, AND SAYING SO. The field is mounted inside the
   * canvas, so its coordinates are the canvas's - the same contract
   * `resolveTextEntryAnchor` keeps with `frame: "canvas"`. Without the marker
   * this point was treated as a window point and the box opened off the sheet.
   */
  return {
    left: box.width / 2,
    top: box.height / 2,
    frame: "canvas",
    centre: true,
  };
}

/*
 * THE ANCHOR IN THE SHEET'S OWN FRAME.
 *
 * The field is mounted ON the canvas, so every position it is given has to be a
 * canvas-local point. Three shapes of anchor are accepted, and each is
 * converted exactly once:
 *
 *   `frame: "canvas"`   already projected for the sheet - used as it is
 *   an OBJECT's anchor  re-projected from the object's own model point, through
 *                       the caller's camera, which is the authoritative route
 *   a plain point       projected through the canvas's box from the window
 *
 * `rect.left`/`rect.top` are WINDOW coordinates whatever the rect claims, so a
 * window anchor has the canvas's origin taken off. Doing that to a point that
 * was already local is the defect this function exists to make impossible.
 */
function localAnchorFor(rect, options = {}) {
  const view = { camera: options.camera };

  if (rect.frame === "canvas" || rect.centre === true) {
    return { x: Number(rect.left) || 0, y: Number(rect.top) || 0 };
  }

  if (options.object) {
    const projected = enggInlineEntry.clientPointForObject(options.object, view);

    if (projected) {
      const bounds = enggInlineEntry.canvasBounds();

      return {
        x: projected.x - (Number(bounds?.rect?.left) || 0),
        y: projected.y - (Number(bounds?.rect?.top) || 0),
      };
    }
  }

  const origin = canvasOrigin();

  return {
    x: (Number(rect.left ?? rect.x) || 0) - origin.left,
    y: (Number(rect.top ?? rect.y) || 0) - origin.top,
  };
}

function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character],
  );
}

const enggNoteEditor = {
  close,
  handleEscape,
  isOpen,
  isInline,
  open,
};

export default enggNoteEditor;


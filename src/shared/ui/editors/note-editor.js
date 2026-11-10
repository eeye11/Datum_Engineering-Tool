import { attachTextSymbols, symbolPickerContains, isSymbolPickerOpen } from "./text-symbol-insert.js";
import { noteTextStyle, noteFontPixels, noteTextWidth } from "../../typography/note-text-style.js";
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
 * So the editor is a SMALL FIELD beside the node instead:
 *
 *   - anchored to the node, at the canvas point the text will occupy;
 *   - with the drawing fully visible behind it, nothing dimmed, nothing hidden;
 *   - typing shown at the node as a live preview, in the feature's own colour,
 *     before anything is committed;
 *   - Enter (single line) or Ctrl+Enter (multi-line) commits, Escape cancels.
 *
 * THE MODAL SHAPE IS STILL HERE, for a caller with no node to hang on - a
 * feature edited from a panel rather than from the canvas. That is a fallback,
 * not the normal route: `open()` prefers the inline prompt whenever an anchor
 * is supplied or can be resolved from the object (see inline-text-entry.js).
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

/* Whether the open prompt is the inline one, as against the modal fallback. */
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
 * ENTER COMMITS A SINGLE LINE; CTRL+ENTER COMMITS A MULTI-LINE ONE.
 *
 * A note is multi-line, so plain Enter has to keep meaning "new line" - an
 * editor that closes on the key a student presses between sentences cannot
 * write sentences. A single-line field has no new line to make, so Enter is
 * free to commit, which is the behaviour the student already expects from
 * every other single-line input in the application.
 *
 * THE PROMPT OWNS THE KEYBOARD WHILE IT IS OPEN. The canvas's global shortcut
 * handler already treats a keystroke that starts in a text field as typing, so
 * drawing shortcuts cannot fire; swallowing propagation here is for the other
 * direction - an ancestor or a tool listener must not act on a key the field
 * is using. A pointer press in the field likewise never reaches the canvas.
 */
function attachKeyHandling(host, { multiline, apply, cancel }) {
  host.addEventListener("keydown", (event) => {
    event.stopPropagation?.();

    if (
      event.key === "Enter" &&
      (multiline ? event.ctrlKey || event.metaKey : !event.shiftKey)
    ) {
      event.preventDefault();
      apply();
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      cancel();
    }
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
  const bottom = height - margin;

  const nodeX = Number(rect.left) || 0;
  const nodeY = Number(rect.top) || 0;

  /*
   * BELOW-RIGHT WHEN IT FITS; OTHERWISE ABOVE, THEN PULLED INTO THE WINDOW.
   */
  let top =
    nodeY + PROMPT_GAP + size.height <= bottom
      ? nodeY + PROMPT_GAP
      : nodeY - PROMPT_GAP - size.height;

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

  host.innerHTML = fieldMarkup(
    false,
    "",
    options.text ?? "",
    "drawing-label-entry-input",
  );

  document.body.appendChild(host);

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

  const place = () => {
    const rect =
      typeof options.anchor === "function" ? options.anchor() : anchor;

    if (!rect) {
      return;
    }

    /*
     * AT THE ANCHOR, NOT BESIDE IT. The prompt sits exactly where the drawn
     * label will sit, so the words do not jump when it is committed; it is
     * nudged only enough to keep a caret's width clear of the point it names.
     */
    const zoom = Number(options.zoom) > 0 ? Number(options.zoom) : 1;
    const size = Math.max(10, Math.round(14 * Math.min(1.6, Math.max(0.7, zoom))));

    host.style.fontSize = `${size}px`;
    input.style.fontSize = `${size}px`;
    input.style.lineHeight = `${Math.round(size * 1.2)}px`;

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
      const nodeX = Number(rect.left) || 0;
      const nodeY = Number(rect.top) || 0;

      const width = host.offsetWidth || 120;
      const height = host.offsetHeight || size * 2;
      const gap = Math.max(8, Math.round(size * 0.9));

      const margin = 6;
      const windowWidth = Number(globalThis.window?.innerWidth) || width + margin * 2;
      const windowHeight =
        Number(globalThis.window?.innerHeight) || height + margin * 2;
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

    host.style.left = `${Math.round(rect.left + 4)}px`;
    host.style.top = `${Math.round(rect.top - size)}px`;
  };

  options.place = place;

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
    close();

    options.onCancel?.();
  };

  attachKeyHandling(openDialog, { multiline: false, apply, cancel });

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
  focusFieldForInput(input, !String(input?.value ?? "").length);

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

  const updatePreview = () => {
    preview?.setText(input ? input.value : "");
    place();
  };

  input?.addEventListener("input", updatePreview);

  const apply = () => {
    const text = input ? input.value : "";

    close();

    options.onApply?.(text);
  };

  const cancel = () => {
    close();

    options.onCancel?.();
  };

  attachKeyHandling(host, { multiline, apply, cancel });

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
    if (finished || host.contains(event.target) || symbolPickerContains(event.target)) {
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
 * `inline: false` asks for the modal explicitly, and an object with no
 * resolvable position (or a page with no canvas) falls back to it, because a
 * prompt anchored to a guessed point is worse than a centred one.
 */
/*
 * ============================================================
 * THE IN-PLACE TEXT EDITOR
 * ============================================================
 *
 * A note is edited WHERE IT IS WRITTEN - the field sits over the drawing at the
 * note's own anchor, in the note's own type, and looks like the text rather
 * than like a form:
 *
 *   - TRANSPARENT background, so the sheet shows through it;
 *   - the rendered note's font family, size, weight, italic, underline, line
 *     spacing and alignment, and its colour (the stylesheet uses `currentColor`);
 *   - only a subtle boundary and the caret while editing - the boundary is the
 *     editor's own box and disappears with it when the text is committed, so no
 *     textbox outline is left in the drawing;
 *   - the box GROWS with what is typed, in width and in lines, so a paragraph
 *     is never written through a one-line window.
 *
 * WHILE IT IS OPEN THE CANVAS MUST NOT STEAL ITS KEYS. Every key that starts in
 * the field is stopped from reaching the drawing's shortcut handler, and every
 * press inside it is stopped from reaching the canvas - so typing is typing, and
 * panning or arming a tool waits until the entry is finished.
 */
function openCanvasText(options) {
  /*
   * A VISIBLE BOX ON THE DRAWING SPACE, NOT A POPUP.
   *
   * The box is a child of the canvas element, positioned in the canvas's own
   * pixel frame - the frame the viewport projects drawing coordinates into - so
   * it sits AT the note's anchor and moves with the drawing when the student
   * zooms, pans or resizes the window. A `position: fixed` prompt anchored to the
   * window looked placed until anything moved; a box inside the canvas is part
   * of the sheet.
   */
  const canvas = enggInlineEntry.canvasElement();
  const host = document.createElement("div");
  host.className = "drawing-canvas-text-editor";
  host.dataset.inline = "true";
  host.setAttribute("role", "group");
  host.setAttribute("aria-label", options.object?.annotateKind === "callout" ? "Edit callout marker" : "Edit note on canvas");
  const input = document.createElement("textarea");
  input.id = "noteText";
  input.setAttribute("aria-label", options.object?.annotateKind === "callout" ? "Callout text" : "Note text");
  input.placeholder = "";
  input.value = options.text || "";
  input.rows = 1;
  input.spellcheck = false;
  input.autocomplete = "off";
  input.wrap = "off";
  host.append(input);

  /*
   * THE SYMBOL BUTTON IS NOT REPEATED HERE. Special Symbols lives in the Tools
   * menu now, and it inserts at THIS field's caret because the field is what
   * has focus.
   */
  (canvas || document.body).append(host);
  openDialog = host;
  let finished = false;

  /*
   * THE BOX IS WRITTEN IN THE NOTE'S OWN TYPE, AND THAT IS NOT CONDITIONAL.
   *
   * The styling used to happen only after the field had been PLACED - so on a
   * page where the canvas has no measurable box (or ``projection`` has no
   * camera to use) the field came up in the browser's default type, looking
   * like a form rather than like the words it is editing. The type is a fact
   * about the OBJECT, so it is applied first and the placement then only
   * decides WHERE the box sits.
   */
  const typography = noteTextStyle(options.object?.style);

  const applyTypography = (zoom) => {
    const zoomed = Number(zoom) || 1;
    const font = noteFontPixels(options.object?.style, zoomed);
    const align = typography.align;

    input.style.fontSize = `${font}px`;
    input.style.lineHeight = `${font * typography.lineSpacing}px`;
    input.style.fontFamily = typography.fontFamily;
    input.style.fontWeight = typography.bold ? "bold" : "normal";
    input.style.fontStyle = typography.italic ? "italic" : "normal";
    input.style.textDecoration = typography.underline ? "underline" : "none";
    input.style.textAlign = align === "center" ? "center" : align === "right" ? "right" : "left";
    input.style.color = /^#[0-9a-f]{6}$/i.test(String(options.object?.style?.stroke || ""))
      ? options.object.style.stroke
      : "var(--datum-ink)";

    return font;
  };

  applyTypography(1);

  const place = () => {
    const box = enggInlineEntry.canvasBounds(
      canvas || enggInlineEntry.canvasElement(),
    );
    const world = enggInlineEntry.modelPointForTextEntry(options.object);

    if (!box || !world) return;

    const projection = enggInlineEntry.createProjection(
      options.state?.camera,
      box,
    );
    const at = projection.toPixels(world);
    const zoom = projection.scale / 2.4;
    const font = applyTypography(zoom);
    const lines = String(input.value || " ").split("\n");

    /*
     * THE BOX FOLLOWS THE TEXT. One empty line still gets a caret's worth of
     * room, and the width tracks the longest line so a wide word is not clipped
     * while it is being typed.
     */
    const width = Math.max(120, noteTextWidth(input.value || " ", typography, font) + 14);
    const height = Math.max(font * typography.lineSpacing, lines.length * font * typography.lineSpacing) + 8;
    const align = typography.align;
    at.x += typography.indent * 2.4 * zoom;
    host.style.left = `${at.x - (align === "center" ? width/2 : align === "right" ? width : 0) - 3}px`;

    /* The anchor is the text's BASELINE, so the field is lifted by one line. */
    host.style.top = `${at.y - height + font * 0.2}px`;
    host.style.width = `${width}px`;
    host.style.height = `${height}px`;
  };
  /*
   * A NEW NODE CANCELLED WHILE STILL EMPTY LEAVES NOTHING BEHIND.
   *
   * Escape on a note that was just placed and never written is the student
   * saying "not here after all", so the node is removed rather than left as an
   * invisible, unselectable object. A node that already had text keeps it.
   */
  const startedEmpty = !String(options.text || "").length;
  const finish = (cancel = false) => {
    if (finished) return;
    finished = true;
    const text = input.value;
    close();
    if (cancel) options.onCancel?.({ startedEmpty });
    else options.onApply?.(text);
  };
  closeCurrent = () => finish(true);
  input.addEventListener("input", () => { options.onInput?.(input.value); place(); });
  input.addEventListener("keydown", event => {
    event.stopPropagation();

    /*
     * ENTER COMMITS A CALLOUT'S SHORT TEXT; A NOTE MAY BE SEVERAL LINES.
     *
     * A balloon holds a name or a number, so Enter finishes it - that is the
     * key a student reaches for. A note is prose, and there Enter has to keep
     * meaning "new line": Ctrl+Enter (or Cmd+Enter) commits it. Escape is the
     * way out of either, and it never deletes the object being edited.
     */
    if (event.key === "Escape") { event.preventDefault(); finish(true); }
    else if (
      event.key === "Enter" &&
      (options.object?.annotateKind === "callout" ? !event.shiftKey : event.ctrlKey || event.metaKey)
    ) { event.preventDefault(); finish(); }
  });
  host.addEventListener("keydown", event => event.stopPropagation());
  host.addEventListener("keyup", event => event.stopPropagation());
  host.addEventListener("pointerdown", event => event.stopPropagation());
  const outside = event => { if (!host.contains(event.target) && !symbolPickerContains(event.target)) finish(); };
  document.addEventListener("pointerdown", outside, true);
  stopOutsidePress = () => document.removeEventListener("pointerdown", outside, true);
  input.addEventListener("blur", () => { if (!isSymbolPickerOpen()) finish(); });
  if (typeof options.cameraSignal === "function") stopFollowing = enggInlineEntry.followCamera(options.cameraSignal, place);
  place();
  /*
   * THE CARET GOES AFTER THE EXISTING TEXT, not in front of it: reopening a
   * written annotation to add to it should not begin by typing over its first
   * word. A balloon still selects all of its number, which is one short token.
   */
  focusField(input);

  if (options.object?.annotateKind === "callout") input.select();
  else input.setSelectionRange(input.value.length, input.value.length);
  return host;
}

function open(options = {}) {
  if (openDialog) closeCurrent?.();
  close();
  if (options.canvasText && options.object) return openCanvasText(options);

  const explicitAnchor =
    options.anchor && typeof options.anchor !== "function"
      ? options.anchor
      : null;

  const resolved =
    options.inline === false
      ? null
      : explicitAnchor ||
        (options.object
          ? enggInlineEntry.resolveTextEntryAnchor(options.object, {
              state: options.state,
              camera: options.camera,
              point: options.point,
            })
          : null);

  if (!resolved) {
    return openModal(options);
  }

  return openInline(options, resolved.rect || explicitAnchor);
}

/*
 * THE MODAL FALLBACK.
 *
 * Kept for a caller that has no node to point at. It is the old editor,
 * unchanged in behaviour - one undoable edit, Enter or Ctrl+Enter to confirm,
 * Escape to cancel - so a feature's text edited from elsewhere behaves as it
 * always has.
 */
function openModal(options) {
  /*
   * ONE EDITOR, TWO SHAPES.
   *
   * A NOTE IS MULTI-LINE and a LABEL, CALLOUT or single-line text is not. Both
   * are the same editor - place content, Enter confirms or Esc cancels, and the
   * current content is shown when the box is reopened on an existing feature -
   * so a student who has learned one has learned the other. Only the field and
   * the key that commits differ:
   *
   *   multiline   Enter = new line, Ctrl+Enter = commit
   *   single line  Enter = commit
   *
   * THE PLACEHOLDER IS SHOWN, NEVER STORED. It is passed to the field's own
   * `placeholder` attribute when the content is empty, so the box says what to
   * write ("Enter note", "Enter label") without that word ever reaching the
   * feature's text.
   */
  const multiline = options.multiline !== false;

  const placeholder =
    options.placeholder || (multiline ? "Enter note" : "Enter text");

  const title = options.title || (multiline ? "Edit Note" : "Edit Text");

  const dialog = document.createElement("div");

  dialog.className = "drawing-dimension-dialog drawing-note-dialog";

  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-label", title);

  dialog.innerHTML = `
        <div class="drawing-dimension-dialog-title">
            ${escapeHtml(title)}
        </div>

        <label class="drawing-dimension-dialog-label" for="noteText">
            ${escapeHtml(multiline ? "Note" : "Text")}
        </label>
        ${fieldMarkup(multiline, placeholder, options.text)}

        <div class="drawing-scale-dialog-actions">
            <button type="button"
                data-note-cancel>Cancel</button>
            <button type="button"
                class="primary"
                data-note-apply>Apply</button>
        </div>
    `;

  document.body.appendChild(dialog);

  openDialog = dialog;
  attachTextSymbols(dialog);

  const closeIt = () => {
    close();
    options.onCancel?.();
  };

  const apply = () => {
    const text = dialog.querySelector("#noteText").value;

    close();

    options.onApply?.(text);
  };

  dialog.querySelector("[data-note-apply]")?.addEventListener("click", apply);

  dialog.querySelector("[data-note-cancel]")?.addEventListener("click", closeIt);

  attachKeyHandling(dialog, { multiline, apply, cancel: closeIt });

  focusField(dialog.querySelector("#noteText"));

  return dialog;
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

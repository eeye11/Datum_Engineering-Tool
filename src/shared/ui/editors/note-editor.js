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
 * THE INLINE PROMPT.
 *
 *   options.anchor        a DOMRect-like point to hang on (window pixels)
 *   options.object        the feature being written - used for the preview
 *   options.cameraSignal  optional: (listener) => unsubscribe. The prompt then
 *                         follows its node when the student zooms or pans.
 */
function openInline(options, anchor) {
  const multiline = options.multiline !== false;

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
    if (finished || host.contains(event.target)) {
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
function open(options = {}) {
  close();

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

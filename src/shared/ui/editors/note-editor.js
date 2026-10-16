/*
 * The Note editor.
 *
 * A Note is the student's own words about the drawing, so it has to be
 * writable: double-clicking it opens this box, the student types, and the
 * text is handed back as ONE change the caller can commit as one undoable
 * action.
 *
 * It is deliberately a small dialog rather than inline editing on the
 * canvas: a note can be multi-line, and a multi-line field is a thing the
 * keyboard's own rules already govern - Enter inserts a newline, and only
 * an explicit confirm (the Apply button or Ctrl+Enter) hands the text back.
 *
 * A GENERATED annotation is refused one, because its text is a reading of
 * its feature and a next redraw would overwrite anything typed - the
 * caller guards for that before opening this.
 */

let openDialog = null;

let closeCurrent = null;

function close() {
  if (openDialog) {
    openDialog.remove();
    openDialog = null;
  }

  closeCurrent = null;
}

function isOpen() {
  return openDialog !== null;
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

function open(options = {}) {
  close();

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

  /*
   * A SINGLE-LINE BOX IS AN INPUT; A MULTI-LINE ONE IS A TEXTAREA. The field's
   * own key handling is then the keyboard's standard behaviour plus the one
   * commit key, which is what makes Enter "commit" here and "new line" there.
   */
  const field = multiline
    ? `<textarea id="noteText"
            class="drawing-property-input drawing-note-dialog-text"
            rows="4"
            placeholder="${escapeHtml(placeholder)}"
            aria-label="${escapeHtml(placeholder)}">${escapeHtml(
              options.text ?? "",
            )}</textarea>`
    : `<input id="noteText"
            type="text"
            class="drawing-property-input"
            placeholder="${escapeHtml(placeholder)}"
            aria-label="${escapeHtml(placeholder)}"
            value="${escapeHtml(options.text ?? "")}">`;

  dialog.innerHTML = `
        <div class="drawing-dimension-dialog-title">
            ${escapeHtml(title)}
        </div>

        <label class="drawing-dimension-dialog-label" for="noteText">
            ${escapeHtml(multiline ? "Note" : "Text")}
        </label>
        ${field}

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

  /*
   * ENTER COMMITS A SINGLE LINE; CTRL+ENTER COMMITS A MULTI-LINE ONE.
   *
   * A note is multi-line, so plain Enter has to keep meaning "new line" - an
   * editor that closes on the key a student presses between sentences cannot
   * write sentences. A single-line field has no new line to make, so Enter is
   * free to commit, which is the behaviour the student already expects from
   * every other single-line input in the application.
   */
  dialog.addEventListener("keydown", (event) => {
    if (
      event.key === "Enter" &&
      (multiline ? event.ctrlKey || event.metaKey : !event.shiftKey)
    ) {
      event.preventDefault();
      apply();
    }

    if (event.key === "Escape") {
      event.preventDefault();
      closeIt();
    }
  });

  const input = dialog.querySelector("#noteText");

  input?.focus();

  /*
   * THE CARET GOES AFTER THE EXISTING CONTENT, not in front of it: reopening a
   * written annotation to add to it should not begin by typing over its first
   * word.
   */
  input?.setSelectionRange?.(input.value.length, input.value.length);

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
  open,
};

export default enggNoteEditor;

/*
 * ============================================================
 * SPECIAL SYMBOLS: INSERT ONE AT THE CARET OF THE ACTIVE TEXT FIELD
 * ============================================================
 *
 * A symbol is TEXT, not a drawing object. So this module does one thing:
 * it finds the field the student is editing, and inserts the chosen glyph at
 * that field's caret - replacing the selection if there is one, keeping
 * everything around it, and leaving the caret after the inserted glyph so
 * typing continues immediately.
 *
 * WHERE IT MAY INSERT.
 *
 * Exactly one field, and it must be ACTIVE: the element that has focus (or,
 * in a browser that reports it, the last element the pointer touched inside
 * the page), and only if it is a real editable text field or a contenteditable
 * region. There is deliberately no fallback. A command that invented a symbol
 * object on the canvas, or wrote the glyph at "the last place the student
 * clicked", would be a second way of drawing that nobody asked for - so when
 * there is no active field the command says so instead.
 *
 * WHY IT IS A COMMAND AND NOT A BUTTON BESIDE THE FIELD.
 *
 * The insert button that used to sit under every text field and every label
 * prompt was a second control doing what the menu can do, and it appeared in
 * places (the small single-line label prompt) where it crowded the editor.
 * The Tools menu is the single door: same picker, same list, same insertion.
 */

import symbolPicker from "./symbol-picker.js";

/* Fields a symbol may be written into. */
const TEXT_INPUT_TYPES = new Set([
  "text",
  "search",
  "email",
  "url",
  "tel",
  "password",
  "",
]);

/*
 * THE FIELD THAT HAS FOCUS.
 *
 * `document.activeElement` is the truth when it is a field; a canvas that
 * swallows focus leaves `body` active, so the element the pointer last
 * pressed inside the editing surface is checked as well. Only a genuinely
 * editable element is ever returned - never the canvas, never the sidebar.
 */
/**
 * The text field a symbol may be written into.
 *
 * @param {{promptOnly?: boolean}} [options]
 * @returns {HTMLElement|null}
 *
 * IT ANSWERS FOR THE OPEN PICKER AS WELL AS FOR THE BUTTON.
 *
 * A press on the quick-access control moves focus out of the text field, and the
 * menu bar itself can take focus - so when the picker asks "where does this go?"
 * it must come back to the field the student was typing in. That is what
 * `promptOnly` is: it accepts ONLY a field inside an open text editor, which is
 * the one place the picker is allowed to write.
 *
 * WITHOUT `promptOnly` the lookup is broader - the focused field anywhere in the
 * page - because the button may legitimately be pressed with a property row
 * focused and no prompt open. A broad lookup is what makes the button work.
 */
export function editableField({ promptOnly = false } = {}) {
  const document = globalThis.document;

  if (!document) {
    return null;
  }

  const active = document.activeElement || null;

  if (isEditableText(active) && !promptOnly) {
    return active;
  }

  /*
   * AN OPEN PROMPT HOLDS ITS OWN FIELD. A prompt is appended to the document
   * when it opens, so the most recent one is the one the student is looking at;
   * a closed prompt is removed, and an editor elsewhere on the page is not a
   * text field waiting for a symbol.
   */
  const prompts = document.querySelectorAll?.(
    ".drawing-inline-entry, .drawing-canvas-text-editor, .drawing-note-dialog, .datum-symbol-target",
  );

  if (!prompts || !prompts.length) {
    return null;
  }

  const field = prompts[prompts.length - 1].querySelector?.(
    "textarea, input[type='text'], input[type='search']",
  );

  return isEditableText(field) ? field : null;
}

function isEditableText(element) {
  if (!element || typeof element !== "object") {
    return false;
  }

  if (element.tagName === "TEXTAREA") {
    return element.readOnly !== true && element.disabled !== true;
  }

  if (element.tagName === "INPUT") {
    return (
      TEXT_INPUT_TYPES.has(String(element.type ?? "").toLowerCase()) &&
      element.readOnly !== true &&
      element.disabled !== true
    );
  }

  return element.isContentEditable === true;
}

/*
 * WRITE THE GLYPH AT THE CARET.
 *
 * A textarea and an input share the platform's selection API; a
 * contenteditable region gets the browser's own `insertText`, which keeps its
 * formatting and its undo stack. Both dispatch the ordinary `input` event a
 * keystroke would, so the field's own live update runs - the canvas label and
 * the Features row follow immediately.
 */
/**
 * Write a glyph into an editable field at its caret.
 *
 * @param {HTMLElement|null} field the editable field that has the focus
 * @param {string} text the glyph to write
 * @returns {boolean} whether the field accepted it
 */
export function insertAtCaret(field, text) {
  if (!field || !text) {
    return false;
  }

  if (field.isContentEditable === true) {
    field.focus?.();

    const wrote =
      typeof globalThis.document?.execCommand === "function"
        ? globalThis.document.execCommand("insertText", false, text)
        : false;

    if (!wrote) {
      const selection = globalThis.getSelection?.();

      if (selection && selection.rangeCount) {
        const range = selection.getRangeAt(0);

        range.deleteContents();
        range.insertNode(globalThis.document.createTextNode(text));
        range.collapse(false);
        selection.removeAllRanges();
        selection.addRange(range);
      }
    }

    field.dispatchEvent(new Event("input", { bubbles: true }));

    return true;
  }

  if (typeof field.setRangeText !== "function") {
    return false;
  }

  const start = Number.isFinite(field.selectionStart)
    ? field.selectionStart
    : field.value.length;
  const end = Number.isFinite(field.selectionEnd) ? field.selectionEnd : start;

  field.setRangeText(text, start, end, "end");
  field.focus?.();

  field.dispatchEvent(new Event("input", { bubbles: true }));

  return true;
}

/* The glyph for a symbol id, or null. */
function symbolText(symbolId) {
  const symbol = symbolPicker.allSymbols().find((item) => item.id === symbolId);

  return symbol && typeof symbol.text === "string" && symbol.text
    ? symbol.text
    : null;
}

/*
 * OPEN THE PICKER AND INSERT WHAT IS CHOSEN.
 *
 * THE PICKER ALWAYS OPENS. It used to refuse when no field had focus, which made
 * the control look broken: pressing a toolbar button moves focus off the text
 * field, so the very press that was meant to open the list was the press that
 * made it think there was nowhere to insert. The field is now remembered when it
 * is focused, and the choice is written there when one is known; when none is,
 * a short notice says to put the caret in a text field first - which is a
 * truthful instruction, not a silent no-op.
 *
 * The field is read BEFORE the picker opens, because the picker takes focus into
 * its search box; the caret it had is remembered so the symbol lands where the
 * student left it, not where the picker's focus moved it.
 */
let lastEditableField = null;

/*
 * THE GUARD IS A MODULE FLAG, NOT A `dataset` ON THE DOCUMENT.
 *
 * It used to write `document.dataset.symbolTracking`, which does not exist on a
 * Document - the very first line of start-up threw, and with it the whole
 * workspace: no tools, no canvas, no panels. A plain boolean cannot have that
 * failure mode.
 */
let trackingInstalled = false;

/* Remember the field the student is typing in, for a later button press. */
export function trackEditableFields(document = globalThis.document) {
  if (!document || trackingInstalled) {
    return;
  }

  trackingInstalled = true;

  const remember = (event) => {
    const target = event.target;

    if (isEditableText(target)) {
      lastEditableField = target;
    }
  };

  document.addEventListener("focusin", remember, true);
  document.addEventListener("pointerdown", remember, true);
}

export function openSpecialSymbols({ onMessage = null } = {}) {
  const focused = editableField();
  const field =
    focused ||
    (lastEditableField && lastEditableField.isConnected ? lastEditableField : null);

  const caret = field
    ? {
        start: Number.isFinite(field.selectionStart)
          ? field.selectionStart
          : (field.value?.length ?? 0),
        end: Number.isFinite(field.selectionEnd) ? field.selectionEnd : field.selectionStart,
      }
    : null;

  symbolPicker.open({
    onPick: (symbolId) => {
      const text = symbolText(symbolId);

      if (!text) {
        return;
      }

      if (!field || !field.isConnected) {
        onMessage?.("Put the text cursor in a text field or a label first, then choose a symbol");

        return;
      }

      /*
       * The picker's own focus does not move the caret of a field behind it,
       * so the remembered position is the one the symbol replaces.
       */
      if (caret && Number.isFinite(caret.start)) {
        field.setSelectionRange?.(
          caret.start,
          Number.isFinite(caret.end) ? caret.end : caret.start,
        );
      }

      insertAtCaret(field, text);
    },

    onCancel: () => {
      field?.focus?.();
    },
  });

  return true;
}

export default {
  openSpecialSymbols,
  editableField,
  trackEditableFields,
};

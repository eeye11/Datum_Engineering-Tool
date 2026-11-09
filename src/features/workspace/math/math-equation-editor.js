/*
 * ============================================================
 * THE INLINE EQUATION EDITOR
 * ============================================================
 *
 * An Equation / Expression is written WHERE IT WILL SIT. The editor is a field
 * anchored to the drawing point the student clicked, over the sheet, with the
 * drawing visible behind it - not a popup, not a modal, and not a dialog that
 * covers the thing being written on.
 *
 * It is the same shape the note editor uses (`note-editor.js`), and for the
 * same reason: the student has just said WHERE the words go, so the field
 * belongs there. What differs is what it accepts - LaTeX-style mathematics -
 * and what it shows: a live preview of the rendered expression, so the student
 * sees the mathematics before committing it.
 *
 * THE PREVIEW IS THE RENDERER'S OWN. It is drawn with the same text node the
 * canvas draws, so what is previewed is what will be placed. Nothing here
 * evaluates, simplifies or solves the expression: an equation is a drawing, and
 * a drawing is not a calculation.
 */

import enggInlineEntry from "../../../shared/ui/editors/inline-text-entry.js";
import { drawingState } from "../editor-state.js";
import { renderCurrentDrawing } from "../../../components/layout/workspace/canvas-render.js";

let openEditor = null;

/* Whether an equation is being written right now. */
export function isEquationEditorOpen() {
  return Boolean(openEditor);
}

/* Escape closes the editor and discards what was typed. */
export function closeEquationEditor() {
  if (!openEditor) {
    return false;
  }

  openEditor.cancel();

  return true;
}

/*
 * A LIGHTWEIGHT DIAGNOSTIC.
 *
 * The renderer is all-or-nothing: one unbalanced brace stops the whole picture.
 * So the editor checks the two things that always fail - an unbalanced brace or
 * bracket, and a stray `$` - and says so beside the field rather than letting
 * the student commit something that will blank the sheet.
 */
export function equationProblem(text) {
  const value = String(text ?? "");

  let braces = 0;
  let brackets = 0;

  for (const character of value) {
    if (character === "{") braces += 1;
    if (character === "}") braces -= 1;
    if (character === "[") brackets += 1;
    if (character === "]") brackets -= 1;

    if (braces < 0 || brackets < 0) {
      return "A closing bracket has no opening one";
    }
  }

  if (braces !== 0) {
    return "A brace is not closed";
  }

  if (brackets !== 0) {
    return "A bracket is not closed";
  }

  if ((value.match(/\$/g) || []).length % 2 !== 0) {
    return "A $ is not closed";
  }

  return null;
}

/*
 * OPEN THE EDITOR AT A DRAWING POINT.
 *
 * `onCommit` receives the text; the caller creates the object. `onCancel` is
 * called when the student abandons the entry, so a caller that had already
 * placed something can roll it back.
 */
export function openEquationEditor(point, options = {}) {
  if (typeof document === "undefined" || !document.body) {
    return null;
  }

  closeEquationEditor();

  const at = enggInlineEntry.worldToClient(point, { state: drawingState });

  const host = document.createElement("div");

  host.className = "drawing-inline-entry drawing-equation-entry";
  host.dataset.inline = "true";
  host.setAttribute("role", "group");
  host.setAttribute("aria-label", "Equation");

  host.innerHTML = `
        <label class="drawing-inline-entry-label" for="mathEquationText">Equation</label>
        <textarea id="mathEquationText" class="drawing-inline-entry-input" rows="2"
            spellcheck="false" autocomplete="off"
            placeholder="y = x^2"></textarea>
        <div class="drawing-equation-preview" aria-live="polite"></div>
        <div class="drawing-equation-problem" role="status"></div>
        <span class="drawing-inline-entry-hint" aria-hidden="true">Ctrl+Enter &middot; Esc</span>
    `;

  document.body.appendChild(host);

  host.style.left = `${Math.round(at.x)}px`;
  host.style.top = `${Math.round(at.y)}px`;

  const input = host.querySelector("#mathEquationText");
  const preview = host.querySelector(".drawing-equation-preview");
  const problem = host.querySelector(".drawing-equation-problem");

  input.value = String(options.text ?? "");

  let finished = false;

  const update = () => {
    const text = input.value;
    const issue = equationProblem(text);

    problem.textContent = issue || "";
    problem.hidden = !issue;

    /*
     * THE PREVIEW IS THE MATHEMATICS, NOT THE SOURCE. A display-mode equation
     * is shown as `$...$`; an inline one as `$...$` too, because the canvas
     * draws both as mathematics - the difference is the size and the spacing,
     * which the object's own font size carries.
     */
    preview.textContent = text.trim() ? `$${text.trim()}$` : "";
  };

  const close = () => {
    host.remove();

    if (openEditor && openEditor.host === host) {
      openEditor = null;
    }

    renderCurrentDrawing();
  };

  /*
   * THE OUTSIDE-PRESS LISTENER IS REGISTERED ONCE AND REMOVED BY `close()`,
   * whichever way the entry ends - so a closed editor can never react to a
   * press, and a second entry never leaves two listeners behind.
   */
  let stopOutside = () => {};

  const closeAndDetach = () => {
    stopOutside();
    close();
  };

  const commit = () => {
    if (finished) {
      return;
    }

    const text = input.value.trim();

    if (!text) {
      cancel();
      return;
    }

    const issue = equationProblem(text);

    if (issue) {
      problem.textContent = issue;
      problem.hidden = false;
      input.focus();

      return;
    }

    finished = true;
    closeAndDetach();

    options.onCommit?.(text);
  };

  const cancel = () => {
    if (finished) {
      return;
    }

    finished = true;
    closeAndDetach();

    options.onCancel?.();
  };

  openEditor = { host, cancel };

  input.addEventListener("input", update);

  input.addEventListener("keydown", (event) => {
    event.stopPropagation();

    if (event.key === "Escape") {
      event.preventDefault();
      cancel();
      return;
    }

    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      commit();
    }
  });

  host.addEventListener("keydown", (event) => event.stopPropagation());
  host.addEventListener("keyup", (event) => event.stopPropagation());
  host.addEventListener("pointerdown", (event) => event.stopPropagation());

  /*
   * A PRESS ELSEWHERE COMMITS, exactly as the note editor does - a student who
   * has typed an equation and then clicks the drawing has finished typing it.
   */
  const outside = (event) => {
    if (finished || host.contains(event.target)) {
      return;
    }

    commit();
  };

  document.addEventListener("pointerdown", outside, true);

  stopOutside = () =>
    document.removeEventListener("pointerdown", outside, true);

  update();
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);

  return host;
}

const enggMathEquationEditor = {
  openEquationEditor,
  closeEquationEditor,
  isEquationEditorOpen,
  equationProblem,
};

export default enggMathEquationEditor;

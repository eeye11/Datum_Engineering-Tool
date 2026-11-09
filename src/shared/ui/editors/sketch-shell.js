/*
 * ========================================================
 * THE SHARED SKETCH EDITOR SHELL
 * ========================================================
 *
 * The interface every Sketch Editor presents: a header, a drawing toolbar, a
 * large drawing workspace and a footer. It is deliberately small, because the
 * editor is a drawing surface and not a form - the canvas is the point, and
 * everything else is a frame around it.
 *
 * WHAT IS SHARED, AND WHAT IS NOT
 * -------------------------------
 * The shell owns the LAYOUT and the CONTROLS: the title, the instruction, the
 * close button, Draw / Erase / Undo / Redo, the canvas element, and Cancel /
 * Apply. It does not own the drawing: each editor supplies its own coordinate
 * mapping, its own reconstruction and its own commit, because a diagram drawn
 * against a beam's axis and a coordinate graph drawn on its own axes are not
 * the same drawing.
 *
 * NO GEOMETRY-TYPE CONTROL. There is no Straight Line button, no Curved Line
 * button and no dropdown anywhere in this shell. The student draws, and the
 * recogniser decides what the stroke is.
 */

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* The default instruction, when an editor does not supply its own. */
export const SKETCH_DEFAULT_INSTRUCTION =
  "Draw a line or a curve - DAETUM recognises which";

/* The instruction shown while the eraser is active. */
export const SKETCH_ERASE_INSTRUCTION =
  "Drag over a stroke to erase part of it";

/*
 * Build the shell's markup.
 *
 * `options.title` and `options.instruction` are the editor's own; everything
 * else is the shared frame. The canvas is an SVG with a viewBox the editor
 * chooses, so the editor's own coordinate system is the one the strokes are
 * stored in - there is no second mapping between the shell and the drawing.
 */
export function sketchShellMarkup(options = {}) {
  const title = escapeHtml(options.title || "Sketch");
  const instruction = escapeHtml(
    options.instruction || SKETCH_DEFAULT_INSTRUCTION,
  );
  const width = Number(options.width) || 900;
  const height = Number(options.height) || 420;
  const applyLabel = escapeHtml(options.applyLabel || "Apply");

  return `
        <div class="sketch-editor">
            <div class="sketch-editor-header">
                <div class="sketch-editor-heading">
                    <div class="sketch-editor-title plot-editor-title">${title}</div>
                    <div class="sketch-editor-instruction" data-sketch-instruction>
                        ${instruction}
                    </div>
                </div>

                <button type="button" class="sketch-editor-close"
                    data-sketch-cancel aria-label="Close the sketch editor">
                    &times;
                </button>
            </div>

            <div class="sketch-editor-toolbar" role="toolbar"
                aria-label="Drawing tools">
                <button type="button" class="sketch-editor-tool active"
                    data-sketch-tool="draw" aria-pressed="true">
                    Draw
                </button>

                <button type="button" class="sketch-editor-tool"
                    data-sketch-tool="erase" aria-pressed="false">
                    Erase
                </button>

                <span class="sketch-editor-divider" aria-hidden="true"></span>

                <button type="button" class="sketch-editor-tool"
                    data-sketch-undo aria-pressed="false" disabled>
                    Undo
                </button>

                <button type="button" class="sketch-editor-tool"
                    data-sketch-redo aria-pressed="false" disabled>
                    Redo
                </button>

                <span class="sketch-editor-hint" data-sketch-hint></span>
            </div>

            <div class="sketch-editor-canvas">
                <svg class="sketch-editor-svg"
                    data-sketch-svg
                    data-sketch-preview
                    viewBox="0 0 ${width} ${height}"
                    preserveAspectRatio="xMidYMid meet"
                    role="img"
                    aria-label="Sketch drawing area"></svg>
            </div>

            <div class="sketch-editor-actions">
                <span class="sketch-editor-status" data-sketch-status></span>

                <span class="sketch-editor-spacer"></span>

                <button type="button" data-sketch-cancel>Cancel</button>
                <button type="button" class="primary" data-sketch-apply>
                    ${applyLabel}
                </button>
            </div>
        </div>
    `;
}

/*
 * Wire the shell's controls to a session.
 *
 * The shell knows nothing about strokes: it asks the session what the tool is,
 * whether there is anything to undo, and what the status line should say. That
 * is what lets one shell serve every editor without any of them re-implementing
 * a toolbar.
 */
export function bindSketchShell(dialog, session, options = {}) {
  const svg = dialog.querySelector("[data-sketch-svg]");
  const hint = dialog.querySelector("[data-sketch-hint]");
  const status = dialog.querySelector("[data-sketch-status]");
  const instruction = dialog.querySelector("[data-sketch-instruction]");

  const drawInstruction = options.instruction || SKETCH_DEFAULT_INSTRUCTION;

  function updateControls() {
    dialog.querySelectorAll("[data-sketch-tool]").forEach((button) => {
      const id = button.dataset.sketchTool;

      if (!id) {
        return;
      }

      const active = session.getTool() === id;

      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });

    const undo = dialog.querySelector("[data-sketch-undo]");
    const redo = dialog.querySelector("[data-sketch-redo]");

    if (undo) {
      undo.disabled = !session.canUndo();
    }

    if (redo) {
      redo.disabled = !session.canRedo();
    }

    const erasing = session.getTool() === "erase";

    if (hint) {
      hint.textContent = erasing ? SKETCH_ERASE_INSTRUCTION : "";
    }

    if (instruction) {
      instruction.textContent = erasing
        ? SKETCH_ERASE_INSTRUCTION
        : drawInstruction;
    }

    if (status) {
      const count = session.getStrokes().length;

      status.textContent = count
        ? `${count} stroke${count === 1 ? "" : "s"}`
        : "";
    }

    svg.classList.toggle("sketch-editor-svg-erase", erasing);
  }

  dialog.querySelectorAll("[data-sketch-tool]").forEach((button) => {
    button.addEventListener("click", () => {
      session.setTool(button.dataset.sketchTool);
    });
  });

  dialog
    .querySelector("[data-sketch-undo]")
    ?.addEventListener("click", () => session.undo());

  dialog
    .querySelector("[data-sketch-redo]")
    ?.addEventListener("click", () => session.redo());

  svg.addEventListener("pointerdown", (event) => {
    event.preventDefault();

    if (session.pointerDown(event)) {
      svg.setPointerCapture?.(event.pointerId);
    }
  });

  svg.addEventListener("pointermove", (event) => {
    session.pointerMove(event);
  });

  svg.addEventListener("pointerup", (event) => {
    event.preventDefault();

    session.pointerUp();

    if (svg.hasPointerCapture?.(event.pointerId)) {
      svg.releasePointerCapture(event.pointerId);
    }
  });

  svg.addEventListener("pointercancel", () => {
    session.pointerCancel();
  });

  return { svg, updateControls };
}

export default {
  SKETCH_DEFAULT_INSTRUCTION,
  SKETCH_ERASE_INSTRUCTION,
  sketchShellMarkup,
  bindSketchShell,
};

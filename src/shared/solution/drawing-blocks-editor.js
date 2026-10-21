/*
 * ============================================================
 * THE PROTECTED DRAWING REFERENCE IN THE SOURCE PANEL
 * ============================================================
 *
 * The Source panel is a <textarea> - which is what keeps selection, undo, paste
 * and the browser's keyboard handling exactly as they should be - and a
 * textarea cannot hold an uneditable region inside it. A drawing inclusion,
 * however, must be an ATOMIC, PROTECTED element: the student may select it,
 * click it and delete it as a whole, but never type into it, cut a brace off it,
 * or paste text over it.
 *
 * So the textarea is the only editable text in the panel, and the inclusion is
 * drawn as a CHIP in a layer above it, at the exact rectangle the command
 * occupies. The command is still in the source (it is what compiles, saves and
 * exports), but it is never on screen as editable characters:
 *
 *   - the chip is a real element, so the browser's own editing model cannot
 *     touch the command: no keyboard can put a caret inside text it cannot see;
 *   - every edit that could reach a command - typing, deleting, pasting,
 *     dragging text, a snippet, a toolbar insert - is checked against the
 *     block's protected range before it is applied (`guardEdit`), and refused;
 *   - a refused edit is not silent: the block is selected and the status line
 *     says what to do instead.
 *
 * THIS IS NOT A STRING-MATCHING TRICK. The protected range is the block the
 * parser found, and the guard runs on the ONE path that writes the editor's
 * value (the workspace's `handleInput`), not on a selection offset guessed after
 * the fact. Text outside a block is edited exactly as before.
 *
 * Positioning: the mirror shares the textarea's padding, font, line height,
 * wrapping and scroll, the same text is laid out in it, and each chip is a
 * `range` over its command - so it sits precisely where the command would have
 * been drawn, including soft-wrapped lines and horizontal scroll.
 */

const CHIPS_ID = "solutionDrawingChips";

const MIRROR_ID = "solutionDrawingMirror";

/* The selection, by block id. One reference is selected at a time. */
let selectedBlockId = null;

let mirrorHost = null;

export function selectedDrawingBlock() {
  return selectedBlockId;
}

export function setSelectedDrawingBlock(blockId) {
  selectedBlockId = blockId || null;
}

export function clearDrawingSelection() {
  selectedBlockId = null;
}

function blocksOf(source, parse) {
  if (typeof parse !== "function") {
    return [];
  }

  try {
    return parse(source) || [];
  } catch (error) {
    return [];
  }
}

/*
 * WHETHER AN EDIT WOULD CUT INTO A COMMAND.
 *
 * `from`/`to` are the range being replaced. It is protected when it overlaps the
 * INSIDE of a block: starting inside it, ending inside it, or spanning it.
 * Replacing the WHOLE command (the deletion the reference chip routes) is the
 * supported removal and is handled by the caller.
 */
export function editTouchesBlock(source, from, to, parse) {
  return (
    blocksOf(source, parse).find((block) => {
      const start = block.index;
      const end = block.index + block.length;

      return (
        (from > start && from < end) ||
        (to > start && to < end) ||
        (from < start && to > end)
      );
    }) || null
  );
}

/* The block a caret belongs to, so a click in the source can select it. */
export function blockAtCaret(source, caret, parse) {
  return (
    blocksOf(source, parse).find(
      (block) => caret >= block.index && caret <= block.index + block.length
    ) || null
  );
}

/*
 * ONE EDIT, CHECKED BEFORE IT IS APPLIED.
 *
 *   { ok: true }                       the edit left every command intact
 *   { ok: true, removed: block }       one whole command was deleted
 *   { ok: false, reason: "protected" } the edit reached inside a command
 */
export function guardEdit(previous, next, parse) {
  const before = blocksOf(previous, parse);

  const value = String(next ?? "");

  if (!before.length) {
    return { ok: true, value };
  }

  if (before.every((block) => value.includes(block.raw))) {
    return { ok: true, value };
  }

  /*
   * A COMMAND IS NO LONGER IN THE RESULT. That is allowed only when the edit
   * removed the whole command and changed nothing else - one at a time, so a cut
   * across three references is refused rather than silently detaching three
   * drawings.
   */
  const removed = before.filter((block) => !value.includes(block.raw));

  if (removed.length === 1) {
    const block = removed[0];

    const rejoined =
      String(previous).slice(0, block.index) +
      String(previous).slice(block.index + block.length);

    const delta = String(previous).length - value.length;

    /*
     * The edit deleted at least the whole command, and what is left is the old
     * text without it, modulo the whitespace the removal took with it.
     */
    if (
      delta >= block.length &&
      value.replace(/\s+/g, "") === rejoined.replace(/\s+/g, "")
    ) {
      return { ok: true, value, removed: block };
    }
  }

  return { ok: false, reason: "protected", block: removed[0] || before[0] };
}

/* -------------------------------------------------------------------------
   THE LAYER
   ------------------------------------------------------------------------- */

function ensureHost(editor) {
  const parent = editor.parentElement;

  if (!parent) {
    return null;
  }

  parent.classList.add("solution-editor-host");

  if (mirrorHost?.root?.isConnected && mirrorHost.root.parentElement === parent) {
    return mirrorHost;
  }

  const root = document.createElement("div");

  root.id = CHIPS_ID;
  root.className = "solution-drawing-chips";

  const mirror = document.createElement("div");

  mirror.id = MIRROR_ID;
  mirror.className = "solution-editor-mirror";
  mirror.setAttribute("aria-hidden", "true");

  root.appendChild(mirror);
  parent.appendChild(root);

  mirrorHost = { root, mirror };

  return mirrorHost;
}

function editorMetrics(editor) {
  const style = window.getComputedStyle(editor);

  /*
   * THE EDITOR'S OWN BOX, so the reference layer can be pinned exactly over it.
   *
   * The layer was `inset: 0` on a flex host, which does NOT line up with a
   * textarea inside a flex column: the chip ended up about 30px to the left,
   * hanging over the line numbers instead of sitting on its own line of text.
   * Measuring the border box and using its offsets is what makes the chip land
   * where the command actually is.
   */
  const rect = editor.getBoundingClientRect?.();
  const parentRect = editor.parentElement?.getBoundingClientRect?.();

  return {
    lineHeight: parseFloat(style.lineHeight) || 20,
    paddingTop: parseFloat(style.paddingTop) || 0,
    paddingRight: parseFloat(style.paddingRight) || 0,
    paddingBottom: parseFloat(style.paddingBottom) || 0,
    paddingLeft: parseFloat(style.paddingLeft) || 0,
    width: rect ? rect.width : 0,
    height: rect ? rect.height : 0,
    offsetLeft: rect && parentRect ? rect.left - parentRect.left : 0,
    offsetTop: rect && parentRect ? rect.top - parentRect.top : 0,
    font: `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`,
    tabSize: style.tabSize || "2",
    letterSpacing: style.letterSpacing || "normal",
    whiteSpace: style.whiteSpace === "pre-wrap" ? "pre-wrap" : "pre",
    wordBreak: style.wordBreak || "normal",
    overflowWrap: style.overflowWrap || "normal"
  };
}

/*
 * PIN THE LAYER OVER THE EDITOR.
 *
 * The layer is absolutely positioned inside the flex host, so `inset: 0` in CSS
 * is only a default: these values move it onto the textarea's own border box, at
 * the same size. The mirror inside then fills the layer with the editor's own
 * padding, font and line height, so a character offset measures to the same
 * pixel the textarea would have drawn it at.
 */
function positionLayer(root, metrics) {
  const measurable = Boolean(metrics.width && metrics.height);

  root.dataset.measured = measurable ? "true" : "false";

  if (!measurable) {
    return;
  }

  root.style.left = `${metrics.offsetLeft}px`;
  root.style.top = `${metrics.offsetTop}px`;
  root.style.width = `${metrics.width}px`;
  root.style.height = `${metrics.height}px`;

  /*
   * A MARK, NOT A MEASUREMENT. The attribute says the layer was placed by the
   * editor rather than left to CSS. It is set either way, so a host that does
   * not lay boxes out (jsdom) can still be asked whether the wiring ran.
   */
  root.dataset.pinned = "true";
}

/*
 * The mirror is the textarea's twin: same box, same type, same wrapping, same
 * scroll. It is not interactive - its only job is to put each command's text at
 * the pixels the textarea would have drawn it on.
 */
function layoutMirror(editor, mirror, metrics) {
  mirror.textContent = editor.value;

  const style = mirror.style;

  style.font = metrics.font;
  style.lineHeight = `${metrics.lineHeight}px`;
  style.letterSpacing = metrics.letterSpacing;
  style.paddingTop = `${metrics.paddingTop}px`;
  style.paddingRight = `${metrics.paddingRight}px`;
  style.paddingBottom = `${metrics.paddingBottom}px`;
  style.paddingLeft = `${metrics.paddingLeft}px`;
  style.tabSize = metrics.tabSize;
  style.whiteSpace = metrics.whiteSpace;
  style.wordBreak = metrics.wordBreak;
  style.overflowWrap = metrics.overflowWrap;

  /*
   * THE MIRROR FILLS THE LAYER, which is already exactly the editor's box - so
   * an offset measured against the mirror is an offset from the editor's own
   * top-left, with no second guess at where the padding or border is.
   */
  style.boxSizing = "border-box";
  style.width = "100%";
  style.height = "100%";

  /* The textarea's own scroll position, not a remembered one. */
  mirror.scrollTop = editor.scrollTop;
  mirror.scrollLeft = editor.scrollLeft;
}

/*
 * WHERE A COMMAND SITS ON SCREEN.
 *
 * `Range.getBoundingClientRect` is the exact answer and is used wherever the
 * engine has it. Where it is missing the caller falls back to the command's
 * LINE - a character count would be wrong as soon as the text wrapped, but a
 * line is always right, and a reference is one line of a command. A layer that
 * cannot measure must never stop the editor.
 */
function measureBlock(mirror, text, block) {
  if (typeof document.createRange !== "function") {
    return null;
  }

  const range = document.createRange();

  range.setStart(text, block.index);
  range.setEnd(text, block.index + block.length);

  return typeof range.getBoundingClientRect === "function"
    ? range.getBoundingClientRect()
    : null;
}

/*
 * DRAW THE REFERENCES over the text.
 *
 * Called on input, on scroll, on resize and when the selection changes. The
 * chips are a derived view: the textarea's value is never written here.
 */
export function renderDrawingBlocks(editor, options = {}) {
  if (!editor) {
    return;
  }

  const { parse, onSelect, onEdit, onRemove } = options;

  const host = ensureHost(editor);

  if (!host) {
    return;
  }

  const { root, mirror } = host;

  const blocks = blocksOf(editor.value, parse);

  editor.classList.toggle("has-drawing-blocks", blocks.length > 0);

  root.querySelectorAll(".solution-drawing-chip").forEach((chip) => chip.remove());

  if (!blocks.length) {
    mirror.textContent = "";

    return;
  }

  const metrics = editorMetrics(editor);

  positionLayer(root, metrics);

  layoutMirror(editor, mirror, metrics);

  const text = mirror.firstChild;

  if (!text) {
    return;
  }

  const hostRect = mirror.getBoundingClientRect();

  /* The label's number is its position in the document ("Drawing 2"). */
  const numbers = new Map(blocks.map((block, index) => [block.blockId, index + 1]));

  blocks.forEach((block) => {
    const selected = block.blockId === selectedBlockId;

    const chip = document.createElement("div");

    chip.className = "solution-drawing-chip";
    chip.dataset.blockId = block.blockId;
    chip.dataset.drawingId = block.drawingId;
    chip.tabIndex = 0;
    chip.setAttribute("role", "button");
    chip.setAttribute(
      "aria-label",
      `Drawing ${numbers.get(block.blockId)} \u2014 protected reference. Press Enter to edit the drawing.`
    );

    if (selected) {
      chip.classList.add("selected");
      chip.setAttribute("aria-current", "true");
    }

    /*
     * THE COMMAND IS SHOWN AS SOURCE, inside the chip - monospaced, in the
     * source's own text colour, exactly the text it stands for. The chip only
     * adds that the command cannot be typed into.
     */
    const code = document.createElement("span");

    code.className = "solution-drawing-chip-code";
    code.textContent = block.raw;

    const label = document.createElement("span");

    label.className = "solution-drawing-chip-label";
    label.textContent = `Drawing ${numbers.get(block.blockId)}`;

    chip.append(code, label);

    /*
     * THE COMPACT CONTEXTUAL ACTION, only once this reference is selected:
     * selecting highlights; it never opens the editor by itself.
     */
    if (selected && typeof onEdit === "function") {
      const edit = document.createElement("button");

      edit.type = "button";
      edit.className = "solution-drawing-chip-edit";
      edit.textContent = "Edit Drawing";
      edit.title = "Open this drawing in the Engineering Drawing workspace";

      /* The action must not take the selection away from the reference. */
      edit.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        event.stopPropagation();
      });

      edit.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();

        onEdit(block);
      });

      chip.appendChild(edit);
    }

    chip.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();

      if (document.activeElement === editor) {
        editor.blur();
      }

      if (typeof onSelect === "function") {
        onSelect(block);
      }
    });

    /* The click is answered above; it must not reach the textarea. */
    chip.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });

    chip.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();

        if (typeof onSelect === "function") {
          onSelect(block);
        }

        return;
      }

      if (event.key === "Backspace" || event.key === "Delete") {
        event.preventDefault();

        if (typeof onRemove === "function") {
          onRemove(block);
        }
      }
    });

    root.appendChild(chip);

    const rect = measureBlock(mirror, text, block);

    if (!rect) {
      /* No measurement: the chip is placed on its line, across the pane. */
      chip.style.left = "0px";
      chip.style.top = `${metrics.paddingTop + block.line * metrics.lineHeight - mirror.scrollTop}px`;
      chip.style.height = `${metrics.lineHeight}px`;
      chip.style.width = "100%";

      return;
    }

    const left = rect.left - hostRect.left + mirror.scrollLeft;
    const top = rect.top - hostRect.top + mirror.scrollTop;

    /*
     * THE CHIP SITS ON ITS OWN LINE'S TEXT, NOT OVER THE GUTTER.
     *
     * It starts where the command starts and is never allowed to begin left of
     * the editor's text column - a reference must read as one of the lines, not
     * as a panel laid across the code.
     */
    chip.style.left = `${Math.max(0, left)}px`;
    chip.style.top = `${top + Math.max(0, (rect.height - metrics.lineHeight) / 2)}px`;
    chip.style.height = `${Math.max(rect.height, metrics.lineHeight)}px`;
    chip.style.maxWidth = `calc(100% - ${Math.max(0, left) + 6}px)`;
  });
}

const enggDrawingBlocksEditor = {
  blockAtCaret,
  clearDrawingSelection,
  editTouchesBlock,
  guardEdit,
  renderDrawingBlocks,
  selectedDrawingBlock,
  setSelectedDrawingBlock
};

export default enggDrawingBlocksEditor;

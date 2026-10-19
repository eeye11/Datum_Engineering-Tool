/*
 * ============================================================
 * THE COLLAPSE LAYER OVER THE SOLUTION EDITOR
 * ============================================================
 *
 * Embedded drawing code can run to dozens or hundreds of lines, and a
 * written solution with three of them expanded is mostly code. This module
 * draws a COLLAPSE LAYER over the editor: a stack of chips, one per
 * embedded drawing, positioned exactly over the lines the block's code
 * occupies, which hide that code behind a one-line summary -
 *     ▶ Embedded drawing — Free-Body Diagram · 48 lines
 *
 * Collapsing is a DISPLAY operation and nothing else. The editor's value is
 * never modified: the full code stays in the document (and in the saved,
 * exported and compiled text) whether a block is collapsed or not, because
 * the chips are a separate element ABOVE the textarea, not text inside it.
 *
 * How it is positioned. The editor is a <textarea> with a known font and
 * line height, and the chips are absolutely positioned inside a mirror that
 * shares the textarea's padding, font and scroll. A block that begins on
 * line 12 and runs 40 lines gets a chip at 12 lines down, 40 lines tall;
 * scrolling the editor scrolls the mirror with it. When a block is
 * EXPANDED, no chip is drawn for it and the code shows as normal source.
 *
 * Independent. Each drawing expands and collapses on its own click; the
 * state is per block, held against the block's marker position, so it
 * survives re-parsing but is not persisted with the document - the
 * document's stored source is identical either way.
 */
import { parseDrawingBlocks } from "./embedded-drawings.js";
import enggErrorLog from "../../app/error-log.js";

const CHIPS_ID = "solutionDrawingChips";

/* The collapsed state, by block index (character position of the BEGIN mark). */
const collapsed = new Set();

let mirrorHost = null;

export function isCollapsed(index) {
  return collapsed.has(index);
}

export function setCollapsed(index, value) {
  if (value) {
    collapsed.add(index);
  } else {
    collapsed.delete(index);
  }
}

export function toggleCollapsed(index) {
  if (collapsed.has(index)) {
    collapsed.delete(index);
  } else {
    collapsed.add(index);
  }

  return collapsed.has(index);
}

export function collapseAll() {
  collapsed.clear();
}

/*
 * The layer, built once beside the editor. The mirror is a sibling of the
 * textarea inside the editor's body, so the workspace's own layout is
 * untouched - the chips float over the text rather than replacing it.
 */
function ensureLayer(editor) {
  if (mirrorHost?.isConnected) {
    return mirrorHost;
  }

  const parent = editor.parentElement;

  if (!parent) {
    return null;
  }

  parent.classList.add("solution-editor-host");

  const layer = document.createElement("div");

  layer.id = CHIPS_ID;
  layer.className = "solution-drawing-chips";
  layer.setAttribute("aria-hidden", "true");

  parent.appendChild(layer);

  mirrorHost = layer;

  return layer;
}

/*
 * THE FONT AND GEOMETRY THE MIRROR MUST MATCH.
 *
 * Read from the textarea's computed style at draw time rather than assumed,
 * because the editor's font is set by the theme and can change with it. A
 * mismatch of one pixel per line drifts a 40-line chip visibly off its
 * block; reading the real values is what makes the overlay exact.
 */
function editorMetrics(editor) {
  const style = window.getComputedStyle(editor);

  const lineHeight =
    parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.5 || 20;

  return {
    lineHeight,
    paddingTop: parseFloat(style.paddingTop) || 0,
    paddingLeft: parseFloat(style.paddingLeft) || 0,
    font: `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`,
  };
}

/*
 * Redraw the layer: parse the editor's value, and for every block that is
 * collapsed place a chip over the lines its code occupies.
 *
 * Called on input (the source may have gained or lost a block), on scroll
 * (the chips follow the text) and on resize. Parsing is cheap - a scan for
 * two marker strings - so running it per keystroke is fine.
 */
export function renderDrawingBlocks(editor) {
  if (!editor) {
    return;
  }

  const layer = ensureLayer(editor);

  if (!layer) {
    return;
  }

  let blocks;

  try {
    blocks = parseDrawingBlocks(editor.value);
  } catch (error) {
    enggErrorLog.reportError("parse embedded drawings", error, {});

    return;
  }

  layer.textContent = "";

  if (!blocks.length) {
    editor.classList.remove("has-drawing-blocks");

    return;
  }

  editor.classList.add("has-drawing-blocks");

  const metrics = editorMetrics(editor);

  layer.style.font = metrics.font;

  const scrollTop = editor.scrollTop;

  blocks.forEach((block) => {
    if (!collapsed.has(block.index)) {
      return;
    }

    const chip = document.createElement("button");

    chip.type = "button";
    chip.className = "solution-drawing-chip";
    chip.setAttribute("aria-expanded", "false");

    const title = document.createElement("span");

    title.className = "solution-drawing-chip-arrow";
    title.textContent = "\u25B6";

    const name = document.createElement("span");

    name.className = "solution-drawing-chip-name";
            name.textContent = "Embedded drawing";

    const count = document.createElement("span");

    count.className = "solution-drawing-chip-count";
    count.textContent = `${block.lines} line${block.lines === 1 ? "" : "s"}`;

    chip.append(title, name, count);

    chip.title = "Click to show this drawing's TikZ code";

    chip.style.top = `${metrics.paddingTop + block.line * metrics.lineHeight - scrollTop}px`;

    const rows = Math.max(block.lines + 2, 2);

    chip.style.height = `${rows * metrics.lineHeight}px`;

    chip.style.width = "100%";

    chip.addEventListener("click", (event) => {
      event.preventDefault();

      toggleCollapsed(block.index);

      renderDrawingBlocks(editor);

      editor.focus();
    });

    layer.appendChild(chip);
  });
}

const enggDrawingBlocksEditor = {
  collapseAll,
  isCollapsed,
  renderDrawingBlocks,
  setCollapsed,
  toggleCollapsed,
};

export default enggDrawingBlocksEditor;

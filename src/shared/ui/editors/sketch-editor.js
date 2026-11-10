/*
 * ========================================================
 * THE SKETCH EDITOR
 * ========================================================
 *
 * A dedicated drawing workspace for a Statics analysis diagram. The student
 * draws with a mouse, a finger or a stylus, and DAETUM works out whether each
 * stroke is a STRAIGHT LINE or a CURVED LINE and reconstructs it as clean
 * geometry.
 *
 * TWO TOOLS, AND ONLY TWO
 * -----------------------
 *
 * Draw and Erase. There is deliberately no Straight Line button, no Curved Line
 * button and no geometry-type dropdown: the student decides WHAT to draw, and
 * the recogniser decides which representation fits it. Asking the student to
 * classify their own stroke would be asking them to do the recogniser's job,
 * and it is the one thing this editor exists to remove.
 *
 * THE INTERFACE AND THE DRAWING BEHAVIOUR ARE SHARED
 * --------------------------------------------------
 *
 * The header, toolbar, canvas and footer come from `sketch-shell.js`, and the
 * pointer capture, sampling, live recognition, erasing and undo/redo come from
 * `sketch-session.js`. What is this editor's own is the FRAME: the diagram's
 * own x range and vertical extent, so a stroke drawn here is at the value the
 * student meant.
 *
 * ONE COORDINATE MAPPING
 * ----------------------
 *
 * `toSketch` and `toScreen` are exact inverses, and they are the only mapping
 * in this file. Pointer input, stroke storage, the preview and the commit all
 * go through them, so a stroke cannot be drawn in one space and committed in
 * another - which is the fault that leaves a canvas looking blank while valid
 * data exists.
 *
 * WHAT IS COMMITTED
 * -----------------
 *
 * A straight stroke becomes a LINE - two points, not a polyline of hundreds of
 * slightly different ones. A curved stroke becomes a POLYLINE through the
 * smoothed points. Both are ordinary DAETUM features, so they are selectable,
 * editable, written to the source and undone like anything else.
 *
 * The editor holds its own working copy while it is open. Nothing reaches the
 * document until Apply, so Cancel genuinely cancels - and an existing sketch
 * that is reopened is left exactly as it was unless the student changes it.
 */

import {
  classifyStroke,
  STROKE_SIMPLIFY_UNITS,
} from "../../geometry/stroke-recognition.js";
import {
  SKETCH_ERASER_PX,
  SKETCH_MAX_POINTS,
  SKETCH_MIN_RUN_PX,
  SKETCH_SAMPLE_PX,
  SKETCH_START_PX,
  SKETCH_TOOLS,
  createSketchSession,
} from "./sketch-session.js";
import {
  SKETCH_DEFAULT_INSTRUCTION,
  bindSketchShell,
  sketchShellMarkup,
} from "./sketch-shell.js";

export {
  SKETCH_ERASER_PX,
  SKETCH_MAX_POINTS,
  SKETCH_MIN_RUN_PX,
  SKETCH_SAMPLE_PX,
  SKETCH_START_PX,
  SKETCH_TOOLS,
};

/*
 * The frame the canvas is drawn in.
 *
 * The graph is the diagram's own: x runs along the body, y is the value. The
 * editor draws the same axes the sheet does, so a stroke drawn here lands where
 * the student expects it on the diagram.
 */
const WIDTH = 900;
const HEIGHT = 420;
const PAD = 24;
const LABEL_BAND = 28;
const Y_LABEL_MARGIN = 40;

let openDialog = null;
let closeCurrent = null;

function svgElement(name, attributes) {
  const element = document.createElementNS(
    "http://www.w3.org/2000/svg",
    name,
  );

  Object.entries(attributes || {}).forEach(([key, value]) => {
    element.setAttribute(key, String(value));
  });

  return element;
}

/* ============================================================
 * THE DIALOG
 * ============================================================ */

function open(options = {}) {
  close();

  const range = options.range || { from: 0, to: 1 };
  const yRange = Number(options.yRange) || 0;

  const dialog = document.createElement("div");

  dialog.className = "drawing-sketch-editor";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-label", options.title || "Sketch Editor");

  dialog.innerHTML = sketchShellMarkup({
    title: options.title || "Sketch",
    instruction: options.instruction || SKETCH_DEFAULT_INSTRUCTION,
    width: WIDTH,
    height: HEIGHT,
    applyLabel: options.applyLabel || "Apply",
  });

  document.body.appendChild(dialog);

  const svg = dialog.querySelector("[data-sketch-svg]");

  /* ========================================================
   * THE FRAME
   * ========================================================
   *
   * The graph the strokes are drawn against. It is the diagram's own x range
   * and its own vertical extent, so a stroke drawn here is at the value the
   * student meant.
   */
  const frame = {
    left: PAD + Y_LABEL_MARGIN,
    right: WIDTH - PAD,
    top: PAD,
    bottom: HEIGHT - PAD - LABEL_BAND,
  };

  const rangeWidth = Math.max(Number(range.to) - Number(range.from), 1e-6);
  const valueExtent = yRange > 0 ? yRange : 1;

  /* Drawing units per screen pixel, and the reverse. */
  const unitsPerPixelX = rangeWidth / (frame.right - frame.left);
  const unitsPerPixelY = valueExtent / (frame.bottom - frame.top);

  /*
   * A SCREEN POINT, IN THE SKETCH'S OWN COORDINATES.
   *
   * The SVG is a fixed viewBox scaled to fit, so the pointer is converted
   * through the element's own box rather than read as a raw offset. `screen`
   * is the position in viewBox units, which is what the sampling threshold and
   * the eraser radius are measured in.
   */
  function toSketch(event) {
    const box = svg.getBoundingClientRect();

    const scaleX = WIDTH / (box.width || WIDTH);
    const scaleY = HEIGHT / (box.height || HEIGHT);

    const x = (event.clientX - box.left) * scaleX;
    const y = (event.clientY - box.top) * scaleY;

    return {
      x: Number(range.from) + (x - frame.left) * unitsPerPixelX,
      y: (frame.bottom - y) * unitsPerPixelY,
      screen: { x, y },
    };
  }

  /* A sketch point, in screen coordinates. The exact inverse of `toSketch`. */
  function toScreen(point) {
    return {
      x: frame.left + (point.x - Number(range.from)) / unitsPerPixelX,
      y: frame.bottom - point.y / unitsPerPixelY,
    };
  }

  /* ========================================================
   * DRAWING
   * ======================================================== */



  /* One recognised stroke, as the ink it is. */
  function drawStroke(entry, style = {}) {
    const points = entry.points.map(toScreen);

    if (points.length < 2) {
      return;
    }

    const path = points
      .map((point, index) =>
        index === 0 ? `M ${point.x} ${point.y}` : `L ${point.x} ${point.y}`,
      )
      .join(" ");

    svg.appendChild(
      svgElement("path", {
        d: path,
        fill: "none",
        stroke: style.stroke || "#1f5c38",
        "stroke-width": style.width || 2,
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
        "stroke-dasharray": style.dashed ? "5 4" : "none",
      }),
    );
  }

  /* ========================================================
   * THE SESSION
   * ========================================================
   *
   * The drawing behaviour is the shared one. This editor supplies only the
   * mapping and the tolerances, which are in ITS units.
   */
  const session = createSketchSession({
    strokes: options.elements,
    toSketch,
    toScreen,
    tolerance: () => STROKE_SIMPLIFY_UNITS * unitsPerPixelX,
    eraserRadius: () => SKETCH_ERASER_PX * unitsPerPixelX,
    minRun: () => SKETCH_MIN_RUN_PX * unitsPerPixelX,
    onChange: () => render(),
  });

  const shell = bindSketchShell(dialog, session, {
    instruction: options.instruction || SKETCH_DEFAULT_INSTRUCTION,
  });

  /*
   * THE EDITOR SHOWS THE STUDENT'S INK AND NOTHING ELSE.
   *
   * No axes, no grid, no ticks, no box. The frame object stays, because it is
   * the MAPPING that decides what value a stroke was drawn at - that arithmetic
   * is what makes the committed geometry land where the diagram expects - but
   * nothing is painted for it.
   */
  function render() {
    svg.innerHTML = "";

    session.getStrokes().forEach((entry) => drawStroke(entry));

    /*
     * THE LIVE PREVIEW. It is drawn dashed, because it is the recogniser's
     * current answer rather than a committed stroke - and it is rebuilt from
     * the stroke so far on every move, so the student watches the clean
     * geometry form.
     */
    const active = session.activeStroke();

    if (active && active.length > 1) {
      drawStroke(
        { points: active },
        { stroke: "#2f7d5a", width: 2, dashed: true },
      );
    }

    /* The eraser, so the student can see what it will take. */
    const eraser = session.eraserPoint();

    if (eraser) {
      const at = toScreen(eraser);

      svg.appendChild(
        svgElement("circle", {
          cx: at.x,
          cy: at.y,
          r: SKETCH_ERASER_PX,
          fill: "none",
          stroke: "#b4453a",
          "stroke-width": 1.5,
          "stroke-dasharray": "3 3",
        }),
      );
    }

    shell.updateControls();
  }

  /* ========================================================
   * APPLY AND CANCEL
   * ======================================================== */

  const cancel = () => {
    close();

    options.onCancel?.();
  };

  dialog.querySelector("[data-sketch-apply]").addEventListener("click", () => {
    const elements = session.exportStrokes();

    close();

    options.onApply?.(elements);
  });

  dialog
    .querySelectorAll("[data-sketch-cancel]")
    .forEach((button) => button.addEventListener("click", cancel));

  dialog.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();

      /*
       * ESCAPE CANCELS THE OPERATION FIRST. A stroke or an erase in progress
       * is what the student almost always means when they press it
       * mid-drawing; only an idle editor closes.
       */
      if (session.abandon()) {
        return;
      }

      cancel();
    }
  });

  openDialog = dialog;
  closeCurrent = cancel;

  render();

  dialog.querySelector(".sketch-editor-close")?.focus();

  return dialog;
}

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

function handleEscape() {
  if (!openDialog) {
    return false;
  }

  closeCurrent?.();

  return true;
}

const enggSketchEditor = {
  SKETCH_TOOLS,
  SKETCH_START_PX,
  SKETCH_SAMPLE_PX,
  SKETCH_ERASER_PX,
  SKETCH_MIN_RUN_PX,
  open,
  close,
  isOpen,
  handleEscape,
  classifyStroke,
};

export default enggSketchEditor;

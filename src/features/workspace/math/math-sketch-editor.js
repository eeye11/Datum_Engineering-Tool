/*
 * ============================================================
 * THE GRAPH SKETCH EDITOR
 * ============================================================
 *
 * The dedicated working space for drawing a Graph by hand. It is opened by
 * Graph -> Sketch, and by editing an existing Sketch-created Graph.
 *
 * WHAT THE STUDENT DOES.
 *
 * They draw the whole graph - the axes, straight lines, curves - with a mouse,
 * a finger or a stylus. There is no Straight Line / Curved Line choice: DAETUM
 * recognises what each stroke is, straightens the ones that are meant to be
 * straight, smooths the ones that are meant to be curved, and reconstructs the
 * lot as clean editable geometry.
 *
 * THE INTERFACE AND THE DRAWING BEHAVIOUR ARE SHARED.
 *
 * The header, toolbar, canvas and footer come from `sketch-shell.js`, and the
 * pointer capture, sampling, live recognition, erasing and undo/redo come from
 * `sketch-session.js` - the same two modules the Statics Sketch Editor uses.
 * What is this editor's own is the FRAME: the graph's coordinate system, drawn
 * by the ordinary `drawMathGraph` painter so the preview is the graph the
 * student is making rather than a lookalike.
 *
 * ONE COORDINATE MAPPING, AND IT IS THE GRAPH'S OWN.
 *
 * The editor works in GRAPH coordinates - the same numbers the committed Plot
 * stores - and `toScreen` maps them into the SVG's viewBox. Pointer input,
 * stroke storage, the preview and the commit all go through that one pair, so
 * a stroke cannot be drawn in one space and committed in another. That
 * mismatch is what left the old editor looking blank while valid data existed.
 *
 * THE RECONSTRUCTED GEOMETRY IS WHAT IS DRAWN.
 *
 * Every committed stroke is rendered from its reconstructed points, not from
 * its raw trace - so what the student sees after releasing the pointer is the
 * clean geometry that Apply will commit. The raw trace is kept as reference
 * data and drawn faintly behind it, never instead of it.
 *
 * NOTHING IS COMMITTED UNTIL APPLY. The strokes live in this editor, not in the
 * document, so Cancel is a true rollback and reopening an editor cannot lose
 * the graph that is already on the sheet.
 */

import enggMathModel from "./math-model.js";
import { drawMathGraph } from "../../../shared/rendering/entities/draw-math.js";
import {
  SKETCH_ERASER_PX,
  SKETCH_MIN_RUN_PX,
  createSketchSession,
} from "../../../shared/ui/editors/sketch-session.js";
import {
  bindSketchShell,
  sketchShellMarkup,
} from "../../../shared/ui/editors/sketch-shell.js";

let openDialog = null;
let closeCurrent = null;

/* The editor's drawing area, in viewBox units. */
const WIDTH = 900;
const HEIGHT = 520;

/* The instruction this editor opens with. */
const INSTRUCTION =
  "Draw the graph - its axes, straight lines and curves. DAETUM cleans each stroke as you draw";

/* ============================================================
 * THE WORKING COPY
 * ============================================================
 *
 * A graph's functions are its curves. The editor starts from ALL of them, not
 * only the sketched ones, so a Plot-created graph opened here shows its curves
 * rather than an empty frame - and a Sketch-created one shows the strokes the
 * student drew.
 */
function workingCopy(graph) {
  const geometry = graph?.geometry || {};

  return {
    id: graph?.id || "graph-preview",
    type: enggMathModel.MATH_PLOT_TYPE,
    name: graph?.name || "Graph",
    style: { ...(graph?.style || {}) },
    engineering: { ...(graph?.engineering || {}) },
    geometry: {
      position: { ...(geometry.position || { x: 0, y: 0 }) },
      width: Number(geometry.width) || 200,
      height: Number(geometry.height) || 200,
      xMin: Number.isFinite(Number(geometry.xMin)) ? Number(geometry.xMin) : -5,
      xMax: Number.isFinite(Number(geometry.xMax)) ? Number(geometry.xMax) : 5,
      yMin: Number.isFinite(Number(geometry.yMin)) ? Number(geometry.yMin) : -5,
      yMax: Number.isFinite(Number(geometry.yMax)) ? Number(geometry.yMax) : 5,
      yRangeExplicit: geometry.yRangeExplicit === true,
      xTickSpacing: geometry.xTickSpacing ?? null,
      yTickSpacing: geometry.yTickSpacing ?? null,
      showXAxis: geometry.showXAxis !== false,
      showYAxis: geometry.showYAxis !== false,
      showGrid: geometry.showGrid !== false,
      showMinorGrid: geometry.showMinorGrid === true,
      showTickLabels: geometry.showTickLabels !== false,
      xLabel: typeof geometry.xLabel === "string" ? geometry.xLabel : "x",
      yLabel: typeof geometry.yLabel === "string" ? geometry.yLabel : "y",
      equalUnits: geometry.equalUnits !== false,
      mode: "sketch",
      functions: enggMathModel
        .plotFunctions(graph)
        .map((component) => ({ ...component })),
    },
  };
}

/* ============================================================
 * THE EDITOR
 * ============================================================ */

export function openSketchEditor(graph, options = {}) {
  if (typeof document === "undefined" || !document.body) {
    return null;
  }

  close();

  const working = workingCopy(graph);

  /*
   * THE STROKES ARE THE EDITOR'S OWN STATE, and they are the graph's function
   * components - the same shape the committed Plot stores. A sketched component
   * carries its reconstructed points; a plotted one carries an expression and
   * is drawn by the frame painter, not by the session.
   */
  const initialStrokes = working.geometry.functions
    .filter((component) => component.mode === "sketch")
    .map((component) => ({
      id: component.id,
      kind: "curved",
      points: component.points || [],
      original: component.originalTrace || component.points || [],
    }));

  const dialog = document.createElement("div");

  /*
   * BOTH CLASSES. `drawing-sketch-editor` is the shared shell's own name and
   * carries its styling; `drawing-plot-editor` is the Graph editor's family
   * name, which the toolbar and the tests use to find either Graph editor.
   */
  dialog.className = "drawing-sketch-editor drawing-plot-editor";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-label", "Graph Sketch Editor");

  dialog.innerHTML = sketchShellMarkup({
    title: options.title || "Graph - Sketch",
    instruction: INSTRUCTION,
    width: WIDTH,
    height: HEIGHT,
    applyLabel: "Apply",
  });

  document.body.appendChild(dialog);

  const svg = dialog.querySelector("[data-sketch-svg]");

  /* ========================================================
   * THE FRAME, AND THE ONE MAPPING
   * ========================================================
   *
   * The graph is drawn into a preview-sized box, and `toScreen` maps a GRAPH
   * coordinate into that box. It is the exact inverse of `toSketch`, and it is
   * the only mapping in this file.
   */
  const frame = {
    position: { x: 0, y: 0 },
    width: WIDTH,
    height: HEIGHT,
  };

  const preview = {
    ...working,
    geometry: {
      ...working.geometry,
      position: { ...frame.position },
      width: frame.width,
      height: frame.height,
    },
  };

  const mapping = enggMathModel.graphMapping(preview);

  /* A graph coordinate, in viewBox units. */
  function toScreen(point) {
    if (!mapping) {
      return { x: 0, y: 0 };
    }

    return {
      x:
        mapping.left +
        ((Number(point.x) - mapping.limits.xMin) / mapping.xSpan) * mapping.width,
      y:
        mapping.bottom +
        ((Number(point.y) - mapping.limits.yMin) / mapping.ySpan) * mapping.height,
    };
  }

  /* A pointer position, in graph coordinates. The exact inverse of `toScreen`. */
  function toSketch(event) {
    const box = svg.getBoundingClientRect();

    const scaleX = WIDTH / (box.width || WIDTH);
    const scaleY = HEIGHT / (box.height || HEIGHT);

    const x = (event.clientX - box.left) * scaleX;
    const y = (event.clientY - box.top) * scaleY;

    if (!mapping) {
      return { x, y, screen: { x, y } };
    }

    return {
      x:
        mapping.limits.xMin +
        ((x - mapping.left) / mapping.width) * mapping.xSpan,
      y:
        mapping.limits.yMin +
        ((mapping.bottom - y) / mapping.height) * mapping.ySpan,
      screen: { x, y },
    };
  }

  /* One graph unit, in viewBox units - the tolerance and eraser are in these. */
  const unitsPerPixel = mapping
    ? mapping.xSpan / Math.max(mapping.width, 1e-9)
    : 1;

  /* ========================================================
   * THE SESSION
   * ======================================================== */

  const session = createSketchSession({
    strokes: initialStrokes,
    toSketch,
    toScreen,
    tolerance: () => 2.5 * unitsPerPixel,
    eraserRadius: () => SKETCH_ERASER_PX * unitsPerPixel,
    minRun: () => SKETCH_MIN_RUN_PX * unitsPerPixel,
    onChange: () => render(),
  });

  const shell = bindSketchShell(dialog, session, { instruction: INSTRUCTION });

  /* ========================================================
   * DRAWING
   * ======================================================== */

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

  function pathFor(points, style = {}) {
    if (!Array.isArray(points) || points.length < 2) {
      return null;
    }

    const d = points
      .map((point, index) => {
        const at = toScreen(point);

        return `${index ? "L" : "M"} ${at.x} ${at.y}`;
      })
      .join(" ");

    return svgElement("path", {
      d,
      fill: "none",
      stroke: style.stroke || "#1f5c38",
      "stroke-width": style.width || 2,
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      ...(style.dashed ? { "stroke-dasharray": "5 4" } : {}),
      ...(style.opacity !== undefined ? { opacity: style.opacity } : {}),
    });
  }

  /*
   * THE FRAME IS DRAWN BY THE ORDINARY PAINTER, from the working graph - so the
   * axes, grid, ticks, labels and any PLOTTED curves are exactly what the sheet
   * will show. The painter appends its group to `parentSvg`, so it is given the
   * editor's SVG as the parent and a group of its own to draw into.
   */
  function drawFrame() {
    const group = svgElement("g", { class: "sketch-editor-frame" });

    try {
      drawMathGraph({
        svg: group,
        parentSvg: svg,
        entity: preview,
        style: preview.style,
        toScreen,
      });
    } catch (error) {
      /*
       * A FRAME THAT CANNOT BE DRAWN MUST NOT TAKE THE STROKES WITH IT. The
       * student's ink is the thing they are working on; a painter failure is
       * reported to the console and the drawing continues.
       */
      console.error("Graph frame could not be drawn", error);
    }
  }

  function render() {
    svg.innerHTML = "";

    drawFrame();

    /*
     * EVERY COMMITTED STROKE, FROM ITS RECONSTRUCTED POINTS. This is the line
     * the old editor was missing: it drew the frame and the in-progress stroke
     * and nothing else, so the canvas went blank the moment the pointer was
     * released.
     */
    session.getStrokes().forEach((entry) => {
      const ink = pathFor(entry.points, { stroke: "#1f5c38", width: 2 });

      if (ink) {
        svg.appendChild(ink);
      }
    });

    /* The stroke being drawn right now, as the recogniser currently reads it. */
    const active = session.activeStroke();

    if (active && active.length > 1) {
      const live = pathFor(active, {
        stroke: "#2f7d5a",
        width: 2,
        dashed: true,
      });

      if (live) {
        svg.appendChild(live);
      }
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
    const strokes = session.exportStrokes();

    if (!strokes.length) {
      const status = dialog.querySelector("[data-sketch-status]");

      if (status) {
        status.textContent = "Draw the graph first, then Apply";
      }

      return;
    }

    const result = {
      strokes: strokes.map((stroke) => ({
        points: stroke.points.map((point) => ({ ...point })),
        segments: enggMathModel.fitCubicBeziers(stroke.points),
        original: stroke.original.map((point) => ({ ...point })),
        showOriginalTrace: true,
      })),
      style: { ...working.style },
    };

    close();

    options.onApply?.(result);
  });

  dialog
    .querySelectorAll("[data-sketch-cancel]")
    .forEach((button) => button.addEventListener("click", cancel));

  dialog.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();

      /* Escape abandons an unfinished stroke or erase before it closes. */
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

export function isSketchEditorOpen() {
  return openDialog !== null;
}

export function closeSketchEditor() {
  if (!openDialog) {
    return false;
  }

  closeCurrent?.();

  return true;
}

const enggMathSketchEditor = {
  openSketchEditor,
  isSketchEditorOpen,
  closeSketchEditor,
};

export default enggMathSketchEditor;

/*
 * ============================================================
 * THE GRAPH SKETCH EDITOR
 * ============================================================
 *
 * The dedicated working space for drawing a Graph by hand. It is opened by
 * Graph -> Sketch, and by editing an existing Sketch-created Graph.
 *
 * WHAT THE STUDENT DOES
 * ---------------------
 *
 * Draws straight lines and curves freehand, and places exact points. There is no
 * Straight Line / Curved Line choice: DAETUM recognises which each stroke is,
 * straightens the ones that are meant to be straight, smooths the ones that are
 * meant to be curved, and shows the result WHILE the sketch is being made.
 *
 * ONE COORDINATE SYSTEM, AND IT IS THE GRAPH'S
 * --------------------------------------------
 *
 * Everything - pointer input, committed geometry, the two previews, Apply and
 * the source - is in GRAPH coordinates, the numbers a plot stores. The screen is
 * a projection of those numbers, and the projection is THE CANVAS'S OWN: the
 * editor builds a preview graph whose box is the canvas and calls
 * `enggMathModel.graphMapping` - the very function the grid, the axes, the
 * placed curves, the hit test and the source writer use. There is no second
 * positioning calculation in this file:
 *
 *     toScreen(graphPoint)       through graphMapping(...)
 *     clientToGraph(clientX, ...) its exact inverse
 *
 * THE WHOLE CANVAS IS THE COORDINATE PLANE.
 *
 * There is no plotting rectangle inside the canvas and no margin around one:
 * xMin is the canvas's left edge, xMax its right, yMin its bottom and yMax its
 * top. So a resize changes the SCALE of the graph and nothing else, and zooming
 * into it is what "more pixels per unit" means - there is no second framing
 * layer that could disagree with the axes.
 *
 * The four numbers come from `math-graph-bounds.js`: CALCULATED from the
 * student's geometry by default (Automatic Bounds), or typed (Manual Bounds).
 * Only explicit points and stroke endpoints are read, so a stroke's samples can
 * never set the scale of the graph.
 *
 * BECAUSE THE BOX IS MEASURED ON EVERY DRAW, resizing the window reframes the
 * graph and changes nothing else: no point is rewritten, no source line is
 * regenerated. That was the old defect - a fixed 900x520 viewBox shrunk to fit
 * whenever the window was larger than that.
 *
 * THREE VIEWS, ONE PIPELINE
 * -------------------------
 *
 * The session holds the RAW strokes. `correctedStrokes()` runs them through the
 * correction pipeline and caches the result; the Original view draws the raw
 * strokes, the Corrected view draws the correction, and the Overlay draws both.
 * APPLY COMMITS THE SAME CACHED CORRECTION the Corrected view drew - there is no
 * second correction pass at Apply, so what was previewed is what lands.
 *
 * THE STUDENT'S POINTS ARE THE ONLY POINTS HEAD RUNNERS SEE
 * --------------------------------------------------------
 *
 * A freehand stroke is hundreds of samples. Those are geometry, not points, and
 * they are never drawn as markers or written as points. Only the markers the
 * student placed - with the Point tool, the table's Add button, or by dragging
 * one of their own points - are stored in `points` and drawn.
 *
 * NOTHING IS COMMITTED UNTIL APPLY. The strokes and points live in this editor,
 * so Cancel is a true rollback and reopening an editor cannot lose the graph
 * that is already on the sheet.
 */

import enggMathModel from "./math-model.js";
import enggMathGraphBounds from "./math-graph-bounds.js";
import enggSketchCorrection from "./math-sketch-correction.js";
import enggGridPlacement from "../../../shared/placement/grid-placement.js";
import { drawMathGraph } from "../../../shared/rendering/entities/draw-math.js";
import { createSvgElement } from "../../../shared/rendering/svg-primitives.js";
import { sketchEditorMarkup } from "../../../shared/ui/editors/sketch-markup.js";
import enggPlacementSession from "../interaction/placement-session.js";

let openDialog = null;
let closeCurrent = null;

/* The instruction this editor opens with. */
const INSTRUCTION =
  "Draw a line or a curve, or place an exact point - DAETUM cleans each stroke as you draw";

/* How close, in screen pixels, a press must be to grab one of the student's points. */
const GRAB_PX = 11;



/* The smallest drag, in screen pixels, that is a stroke rather than a tap. */
const MIN_STROKE_PX = 3;

/* The closest two recorded samples may be, in screen pixels. */
const SAMPLE_PX = 2;

/* A stroke wider than this is capped: a sketch is a drawing, not a scan. */
const MAX_SAMPLES = 2000;

/* The eraser's radius, in screen pixels. */
const ERASER_PX = 11;

/* A run shorter than this, in screen pixels, is dropped rather than kept. */
const MIN_RUN_PX = 5;

/* The narrowest the editor allows its layout to be before folding controls. */
const NARROW_QUERY = "(max-width: 900px)";

/*
 * THE BOUNDS MODES.
 *
 * `auto` is the default and the one a student should never have to think about:
 * the range follows the geometry. `manual` is what typing a bound means - from
 * then on the four numbers are theirs and nothing recalculates them.
 */
export const BOUNDS_MODES = Object.freeze(["auto", "manual"]);

export const DEFAULT_BOUNDS_MODE = "auto";

/* A graph coordinate, or null. */
function finiteTarget(point) {
  return Boolean(
    point &&
    Number.isFinite(Number(point.x)) &&
    Number.isFinite(Number(point.y)),
  );
}

function copyPoint(point) {
  return { x: Number(point.x), y: Number(point.y) };
}

/* A configured limit: a finite number, or the fallback for "unset". */
function limitOf(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/* A point after a placement transform - one rule for every stored coordinate. */
function placedPoint(point, offset) {
  return {
    x: Number(point.x) * offset.scale + offset.dx,
    y: Number(point.y) * offset.scale + offset.dy,
  };
}

function numberText(value) {
  const number = Number(value);

  return Number.isFinite(number) ? String(Number(number.toFixed(4))) : "";
}

let pointCounter = 0;

function nextPointId() {
  pointCounter += 1;

  return `point-${Date.now().toString(36)}-${pointCounter}`;
}

function nextStrokeId() {
  pointCounter += 1;

  return `stroke-${Date.now().toString(36)}-${pointCounter}`;
}

/* ============================================================
 * THE WORKING COPY
 * ============================================================
 *
 * The editor never touches the document. It holds a plain object shaped like a
 * graph, and the preview draws it through the ordinary renderer.
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
      position: { x: 0, y: 0 },
      width: 200,
      height: 200,
      /*
       * THE STUDENT'S CONFIGURED BOUNDS, carried through as they are. `null`
       * and `""` are UNSET, not zero - treating them as 0 turned an asymmetric
       * -10..5 into 0..5 and moved every coordinate with it.
       */
      xMin: limitOf(geometry.xMin, -5),
      xMax: limitOf(geometry.xMax, 5),
      yMin: limitOf(geometry.yMin, -5),
      yMax: limitOf(geometry.yMax, 5),
      yRangeExplicit: geometry.yRangeExplicit === true,
      /*
       * WHICH MODE THE GRAPH WAS LEFT IN. A reopened automatic graph follows its
       * geometry again; a reopened manual one keeps the numbers it was saved
       * with, because changing them is what the student chose not to have.
       */
      boundsMode: BOUNDS_MODES.includes(geometry.boundsMode)
        ? geometry.boundsMode
        : DEFAULT_BOUNDS_MODE,
      manualBounds: enggMathGraphBounds.validBounds(geometry.manualBounds)
        ? { ...geometry.manualBounds }
        : enggMathGraphBounds.validBounds({
              xMin: geometry.xMin,
              xMax: geometry.xMax,
              yMin: geometry.yMin,
              yMax: geometry.yMax,
            })
          ? {
              xMin: Number(geometry.xMin),
              xMax: Number(geometry.xMax),
              yMin: Number(geometry.yMin),
              yMax: Number(geometry.yMax),
            }
          : null,
      xTickSpacing: geometry.xTickSpacing ?? null,
      yTickSpacing: geometry.yTickSpacing ?? null,
      gridDivisions: Number(geometry.gridDivisions) || 2,
      showXAxis: geometry.showXAxis !== false,
      showYAxis: geometry.showYAxis !== false,
      showGrid: geometry.showGrid !== false,
      showMinorGrid: geometry.showMinorGrid === true,
      showTickLabels: false,
      xLabel: typeof geometry.xLabel === "string" ? geometry.xLabel : "x",
      yLabel: typeof geometry.yLabel === "string" ? geometry.yLabel : "y",
      equalUnits: geometry.equalUnits !== false,
      mode: "sketch",
      points: Array.isArray(geometry.points)
        ? geometry.points.filter(finiteTarget).map((entry) => ({
            id: entry.id || nextPointId(),
            x: Number(entry.x),
            y: Number(entry.y),
          }))
        : [],
      functions: [],
    },
  };
}

/* The strokes a saved sketch holds, as the editor's own raw stroke shape. */
function strokesOf(graph) {
  return enggMathModel
    .plotFunctions(graph)
    .filter((component) => component.mode === "sketch")
    .map((component) => ({
      id: component.id,
      points: Array.isArray(component.points)
        ? component.points.map(copyPoint)
        : [],
      original:
        Array.isArray(component.originalTrace) && component.originalTrace.length
          ? component.originalTrace.map(copyPoint)
          : Array.isArray(component.points)
            ? component.points.map(copyPoint)
            : [],
      correction: component.correction || null,
    }));
}

/* ============================================================
 * THE EDITOR
 * ============================================================ */

export function openSketchEditor(graph, options = {}) {
  if (typeof document === "undefined" || !document.body) {
    return null;
  }

  /*
   * A TRACE OF WHAT RAN, INSTEAD OF A HYPOTHESIS.
   *
   * The editor is opened from three places - the toolbar, the Features panel and
   * a reopened graph - and a fault in this file is indistinguishable from a
   * stale build when the only evidence is what the page shows. So each step of
   * an open is recorded on a global the page can read back, and the FIRST thing
   * written is the module's own URL: if the page loads this file twice, the two
   * traces say so, and if a step is missing from the trace that step threw.
   */
  const trace = () => {
    if (typeof globalThis !== "object" || !globalThis) {
      return;
    }

    globalThis.__sketchTrace = globalThis.__sketchTrace || [];
  };

  trace();
  globalThis.__sketchTrace.push(
    `open @ ${import.meta.url} opens=${Number(globalThis.__sketchOpens) || 0}`,
  );
  globalThis.__sketchOpens = (Number(globalThis.__sketchOpens) || 0) + 1;

  close();

  const working = workingCopy(graph);

  const strokes = enggSketchCorrection
    .correctSketch(strokesOf(graph), { strength: "off", straighten: false })
    .map((entry) => ({
      id: entry.id || nextStrokeId(),
      points: entry.points.map(copyPoint),
      original: entry.original.map(copyPoint),
    }));

  let points = working.geometry.points.map((entry) => ({ ...entry }));

  let tool = "draw";
  let view = "corrected";
  let strength = enggSketchCorrection.DEFAULT_CORRECTION_STRENGTH;
  let straighten = true;
  let showTrace = true;
  let selectedPointId = points.length ? points[0].id : null;
  let inspectorOpen = true;

  let drag = null;
  let cursor = null;
  let correctedCache = null;
  let snapEnabled = true;

  const history = { past: [], future: [] };

  /*
   * THE BOUNDS - THE WHOLE COORDINATE SPACE, AS FOUR NUMBERS.
   *
   * `mode` decides where they come from: calculated from the geometry, or typed.
   * `bounds` is the manual range (null until the student states one) and
   * `settled` is the last valid range in force - what a half-typed edit falls
   * back to, so the graph never jumps to a guess.
   */
  let boundsMode = BOUNDS_MODES.includes(working.geometry.boundsMode)
    ? working.geometry.boundsMode
    : DEFAULT_BOUNDS_MODE;

  let manualBounds = enggMathGraphBounds.validBounds(working.geometry.manualBounds)
    ? { ...working.geometry.manualBounds }
    : null;

  let settledBounds = {
    xMin: working.geometry.xMin,
    xMax: working.geometry.xMax,
    yMin: working.geometry.yMin,
    yMax: working.geometry.yMax,
  };

  const dialog = document.createElement("div");

  dialog.className =
    "drawing-sketch-editor drawing-plot-editor drawing-graph-sketch";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-label", options.title || "Graph Sketch Editor");

  dialog.innerHTML = sketchEditorMarkup({
    title: options.title || "Graph - Sketch",
    instruction: INSTRUCTION,
    view,
  });

  document.body.appendChild(dialog);

  const app = dialog.querySelector("[data-sketch-app]");
  const stage = dialog.querySelector("[data-sketch-stage]");
  const svg = dialog.querySelector("[data-sketch-svg]");
  const pointsList = dialog.querySelector("[data-sketch-points]");
  const statusNode = dialog.querySelector("[data-sketch-status]");
  const hintNode = dialog.querySelector("[data-sketch-hint]");
  const instructionNode = dialog.querySelector("[data-sketch-instruction]");
  const readoutNode = dialog.querySelector("[data-sketch-coordinates]");
  const summaryNode = dialog.querySelector("[data-sketch-correction-summary]");

  /*
   * THE CANVAS'S OWN BOX, READ FROM THE LAYOUT.
   *
   * The SVG has a 1:1 viewBox and `preserveAspectRatio="none"`, so a graph
   * coordinate maps straight through this box. Reading it on every draw is what
   * makes the editor resizable: there is no stored size to fall out of step
   * with the window.
   */
  function canvasBox() {
    const rect = svg.getBoundingClientRect?.();

    const width = rect && rect.width > 0 ? rect.width : 0;
    const height = rect && rect.height > 0 ? rect.height : 0;

    if (!(width > 0) || !(height > 0)) {
      return null;
    }

    return { left: rect.left || 0, top: rect.top || 0, width, height };
  }

  function sizeCanvas() {
    const box = canvasBox();

    if (!box) {
      return;
    }

    svg.setAttribute("viewBox", `0 0 ${box.width} ${box.height}`);
    svg.setAttribute("width", String(box.width));
    svg.setAttribute("height", String(box.height));
  }

  /* ============================================================
   * THE BOUNDS
   * ============================================================
   *
   * The four numbers the whole canvas represents. In AUTOMATIC mode they are
   * calculated from the geometry that is actually there; in MANUAL mode they are
   * what the student typed. `settled` keeps the last valid answer, so a
   * half-typed range never moves the graph.
   */



  /*
   * THE BOUNDS IN FORCE, WITHOUT RECALCULATING THEM.
   *
   * This is what the mapping reads, on every draw and every pointer event, so
   * it must never call the correction: the correction's tolerance is a screen
   * distance converted through THIS mapping, and going back the other way would
   * be a cycle. The automatic range is recalculated in `refitBounds`, once per
   * change - and `currentBounds` only ever reports it.
   */
  function currentBounds() {
    if (boundsMode === "manual" && enggMathGraphBounds.validBounds(manualBounds)) {
      return manualBounds;
    }

    return settledBounds;
  }

  /*
   * RE-CALCULATE THE BOUNDS AFTER A CHANGE TO THE GEOMETRY.
   *
   * Called on every add, move, delete and correction. In MANUAL mode it does
   * nothing at all: the student's range is theirs, and geometry that leaves it
   * is REPORTED rather than accommodated.
   */
  function refitBounds() {
    if (boundsMode !== "auto") {
      return false;
    }

    settledBounds = enggMathGraphBounds.automaticBounds({
      points,
      strokes: correctedStrokes(),
    });

    return true;
  }



  /*
   * THE ONE PROJECTION: graph coordinate -> canvas pixel.
   *
   * The whole canvas is the plane. There is no inset, no plotting rectangle
   * inside it and no second scale: xMin is pixel 0, xMax is the right edge,
   * yMax is pixel 0 and yMin is the bottom edge. Everything in this editor - the
   * axes, the grid, the curves, the markers, the pointer and its readout, the
   * snap and the hit test - goes through this pair and its exact inverse.
   */
  function toScreen(point) {
    const box = canvasBox();

    if (!box) {
      return { x: 0, y: 0 };
    }

    const bounds = currentBounds();

    const spanX = Math.max(bounds.xMax - bounds.xMin, 1e-12);
    const spanY = Math.max(bounds.yMax - bounds.yMin, 1e-12);

    return {
      x: ((Number(point.x) - bounds.xMin) / spanX) * box.width,
      y: ((bounds.yMax - Number(point.y)) / spanY) * box.height,
    };
  }

  /* A canvas position, in graph coordinates - the exact inverse of `toScreen`. */
  function screenToGraphAt(x, y) {
    const box = canvasBox();

    if (!box) {
      return null;
    }

    const bounds = currentBounds();

    const spanX = Math.max(bounds.xMax - bounds.xMin, 1e-12);
    const spanY = Math.max(bounds.yMax - bounds.yMin, 1e-12);

    return {
      x: bounds.xMin + (x / box.width) * spanX,
      y: bounds.yMax - (y / box.height) * spanY,
      screen: { x, y },
    };
  }

  /* A client pointer position, in graph coordinates. */
  function clientToGraph(clientX, clientY) {
    const box = canvasBox();

    if (!box) {
      return null;
    }

    return screenToGraphAt(clientX - box.left, clientY - box.top);
  }

  /*
   * A SCREEN DISTANCE, IN GRAPH UNITS.
   *
   * One unit is a different number of pixels on each axis unless the bounds'
   * span matches the canvas's proportions, so the LARGER of the two conversions
   * is taken: a tolerance measured this way never becomes smaller than the
   * student can aim at on the axis where units are densest.
   */
  function unitsForPixels(pixels) {
    const box = canvasBox();

    if (!box) {
      return pixels;
    }

    /*
     * THE SETTLED RANGE, not `currentBounds()`: this is called BY the
     * correction, which `refitBounds` calls, so reading the manual range
     * directly is what keeps the two from calling each other forever. In manual
     * mode `settled` is the manual range already, and in automatic mode it is
     * the last calculation - both are the range on screen.
     */
    const bounds =
      boundsMode === "manual" && enggMathGraphBounds.validBounds(manualBounds)
        ? manualBounds
        : settledBounds;

    const perPixelX = (bounds.xMax - bounds.xMin) / Math.max(box.width, 1e-9);
    const perPixelY = (bounds.yMax - bounds.yMin) / Math.max(box.height, 1e-9);

    return pixels * Math.max(perPixelX, perPixelY);
  }

  /* The origin's place on the canvas - the same mapping everything else uses. */
  function mappingOrigin() {
    return toScreen({ x: 0, y: 0 });
  }

  function mappingSummary() {
    const box = canvasBox();
    const bounds = currentBounds();

    if (!box) {
      return null;
    }

    const spanX = Math.max(bounds.xMax - bounds.xMin, 1e-12);
    const spanY = Math.max(bounds.yMax - bounds.yMin, 1e-12);

    return {
      /* THE CANVAS IS THE PLOT AREA - the full box, no inset. */
      left: 0,
      right: box.width,
      bottom: box.height,
      top: 0,
      width: box.width,
      height: box.height,
      scaleX: box.width / spanX,
      scaleY: box.height / spanY,
      equal: Math.abs(box.width / spanX - box.height / spanY) < 1e-6,
      limits: { ...bounds },
      origin: mappingOrigin(),
      mode: boundsMode,
    };
  }

  /*
   * THE GRAPH THE FRAME IS DRAWN FROM.
   *
   * `drawMathGraph` knows one thing about a graph: its box. This builds a box
   * that IS the canvas - zero inset, the canvas's pixel size as its dimensions,
   * and the bounds as its limits - so the grid, the axes and the ticks are laid
   * out edge to edge. The stored geometry is untouched: this is a throwaway
   * drawing frame.
   */
  function previewGraph() {
    const box = canvasBox() || { width: 800, height: 520 };
    const bounds = currentBounds();

    return {
      id: "graph-preview",
      type: enggMathModel.MATH_PLOT_TYPE,
      name: working.name,
      style: { ...(working.style || {}) },
      engineering: { ...(working.engineering || {}) },
      geometry: {
        ...working.geometry,
        position: { x: 0, y: 0 },
        width: Math.max(enggMathModel.MIN_GRAPH_SIDE, box.width),
        height: Math.max(enggMathModel.MIN_GRAPH_SIDE, box.height),
        xMin: bounds.xMin,
        xMax: bounds.xMax,
        yMin: bounds.yMin,
        yMax: bounds.yMax,
        yRangeExplicit: true,
        /*
         * NO INSET AND NO EQUAL-UNIT SQUARE IN THE EDITOR. The bounds ARE the
         * canvas: an inner square centred in a wide canvas would leave the sides
         * of the canvas outside the graph, which is exactly the empty margin this
         * layout removes.
         */
        graphInset: { left: 0, right: 0, top: 0, bottom: 0 },
        equalUnits: false,
        showTickLabels: false,
        functions: [],
      },
    };
  }

  /*
   * PAN BY A SCREEN DISTANCE.
   *
   * A pan is a translation of the range, so the drag moves the BOUNDS by the
   * graph distance the cursor travelled. In automatic mode the range becomes the
   * student's (the graph stops chasing the geometry) until Fit; in manual mode
   * the typed numbers move with the view, which is what a pan looks like either
   * way.
   */
  function panBy(deltaX, deltaY) {
    const box = canvasBox();

    if (!box) {
      return;
    }

    const bounds = currentBounds();

    const shiftX = (deltaX / Math.max(box.width, 1e-9)) * (bounds.xMax - bounds.xMin);
    const shiftY = (deltaY / Math.max(box.height, 1e-9)) * (bounds.yMax - bounds.yMin);

    settledBounds = {
      xMin: bounds.xMin - shiftX,
      xMax: bounds.xMax - shiftX,
      yMin: bounds.yMin + shiftY,
      yMax: bounds.yMax + shiftY,
    };

    if (boundsMode === "manual") {
      manualBounds = { ...settledBounds };
      renderBoundsMode();
    } else {
      /*
       * A PAN IN AUTOMATIC MODE IS A TYPED RANGE: the student has chosen where
       * they are looking, so the range stops following the geometry. Switching
       * the mode is stated rather than implied - the controls change to Manual
       * and the fields show what is now in force.
       */
      boundsMode = "manual";
      manualBounds = { ...settledBounds };
      renderBoundsMode();
    }

    draw();
  }

  /* Fit: return to the calculation, which is what Automatic Bounds IS. */
  function fitBounds() {
    boundsMode = DEFAULT_BOUNDS_MODE;
    settledBounds = enggMathGraphBounds.automaticBounds({
      points,
      strokes: correctedStrokes(),
    });

    refresh();
  }

  /* What is drawn outside a manual range - reported, never accommodated. */
  function outOfBounds() {
    if (boundsMode !== "manual") {
      return [];
    }

    return enggMathGraphBounds.outsideBounds(currentBounds(), {
      points,
      strokes: correctedStrokes(),
    });
  }



  /* ============================================================
   * THE POINTS
   * ============================================================ */

  function snapPoint(point) {
    const steps = gridSteps();

    const snapOn = dialog.querySelector(
      '[data-sketch-toggle-setting="snap"]',
    )?.checked;

    if (!snapOn) {
      return { x: point.x, y: point.y };
    }

    /*
     * SNAPPING USES THE CONFIGURED NUMBERS, which is what makes an unnumbered
     * grid still exact: the grid's lines are at multiples of the same step the
     * snap rounds to, so a snapped point always lands on a visible line - and a
     * graph with no spacing typed lands on the same "nice" step its lines are
     * drawn at (`gridValues`), not on a pixel.
     */
    return {
      x: Math.round(point.x / steps.x) * steps.x,
      y: Math.round(point.y / steps.y) * steps.y,
    };
  }

  /*
   * THE SNAP STEP ON EACH AXIS, in graph units.
   *
   * It is the CONFIGURED step - the number the student types as "x step", or the
   * neat step the range deserves when they have typed none. The drawn grid is a
   * SUBDIVISION of it (`gridDivisions` lines per step, so the lines are finer),
   * and a snap deliberately rounds to the COARSER of the two: every snapped
   * point lands on a line, and a drag of one cell moves exactly one step rather
   * than a fifth of one.
   *
   * A stored spacing of null is no spacing, so it falls back to the neat step
   * of the range rather than dividing by zero.
   */
  function gridSteps() {
    const bounds = currentBounds();

    const stepOf = (spacing, min, max) => {
      const typed = Number(spacing);

      if (Number.isFinite(typed) && typed > 0) {
        return typed;
      }

      const span = Math.max(Number(max) - Number(min), 1e-9);

      return niceStepOf(span);
    };

    return {
      x: stepOf(working.geometry.xTickSpacing, bounds.xMin, bounds.xMax),
      y: stepOf(working.geometry.yTickSpacing, bounds.yMin, bounds.yMax),
    };
  }

  function pointById(id) {
    return points.find((entry) => entry.id === id) || null;
  }

  function selectedPoint() {
    return pointById(selectedPointId);
  }

  function snapshot() {
    return {
      strokes: strokes.map((entry) => ({
        id: entry.id,
        points: entry.points.map(copyPoint),
        original: entry.original.map(copyPoint),
      })),
      points: points.map((entry) => ({ ...entry })),
      selectedPointId,
    };
  }

  function restore(state) {
    strokes.length = 0;
    strokes.push(
      ...state.strokes.map((entry) => ({
        id: entry.id,
        points: entry.points.map(copyPoint),
        original: entry.original.map(copyPoint),
      })),
    );

    points = state.points.map((entry) => ({ ...entry }));
    selectedPointId = state.selectedPointId;
  }

  /* ONE undoable change: the `before` snapshot, then synchronised views. */
  function record(before) {
    history.past.push(before);
    history.future.length = 0;
  }

  function undo() {
    if (!history.past.length) {
      return false;
    }

    history.future.push(snapshot());
    restore(history.past.pop());

    refresh();

    return true;
  }

  function redo() {
    if (!history.future.length) {
      return false;
    }

    history.past.push(snapshot());
    restore(history.future.pop());

    refresh();

    return true;
  }

  /* ============================================================
   * THE CORRECTION
   * ============================================================ */

  function correctedStrokes() {
    if (correctedCache) {
      return correctedCache;
    }

    correctedCache = enggSketchCorrection.correctSketch(strokes, {
      strength,
      straighten,
      tolerance: unitsForPixels(1.2),
    });

    return correctedCache;
  }

  /*
   * THE CORRECTED GEOMETRY Apply WILL COMMIT.
   *
   * It is built from the SAME cached correction the canvas drew, so the two
   * cannot disagree - and it is built the same way for a preview and for a
   * commit, which is why Apply cannot surprise the student.
   */
  /*
   * A CORRECTED STROKE'S CONTROL VERTICES.
   *
   * The committed component stores its SKELETON (`points`) and the Bezier chain
   * fitted through it (`segments`). The skeleton is the Bezier chain's own
   * endpoints - the samples would be a hundred points on a line - so both are
   * derived from the one cached correction and follow the placement transform
   * together.
   */
  function verticesOfCorrected(entry) {
    const segments = Array.isArray(entry.segments) ? entry.segments : [];

    if (!segments.length) {
      return entry.points.map(copyPoint);
    }

    return [
      copyPoint(segments[0].from),
      ...segments.map((segment) => copyPoint(segment.to)),
    ];
  }

  function correctedGraphFunctions(offset = { dx: 0, dy: 0, scale: 1 }) {
    return correctedStrokes()
      .filter((entry) =>
        entry.points.length > 1 || (entry.segments?.length || 0) > 0,
      )
      .map((entry) =>
        enggMathModel.createSketchFunction(
          {
            points: verticesOfCorrected(entry).map((point) =>
              placedPoint(point, offset),
            ),
            segments: enggMathModel
              .fitCubicBeziers(verticesOfCorrected(entry))
              .map((segment) => ({
                from: placedPoint(segment.from, offset),
                control1: placedPoint(segment.control1, offset),
                control2: placedPoint(segment.control2, offset),
                to: placedPoint(segment.to, offset),
              })),
            original: entry.original.map((point) => placedPoint(point, offset)),
          },
          {
            showOriginalTrace: showTrace,
            correction: entry.correction,
          },
        ),
      );
  }



  /* ============================================================
   * DRAWING
   * ============================================================ */

  /* A polyline, from graph points. */
  function pathElement(graphPoints, attributes) {
    if (!Array.isArray(graphPoints) || graphPoints.length < 2) {
      return null;
    }

    const d = graphPoints
      .map((point) => {
        const at = toScreen(point);

        return `${at.x.toFixed(2)} ${at.y.toFixed(2)}`;
      })
      .map((pair, index) => `${index ? "L" : "M"} ${pair}`)
      .join(" ");

    return createSvgElement("path", { d, fill: "none", ...attributes });
  }

  /*
   * A STROKE AS A SMOOTH PATH.
   *
   * A corrected curve is drawn through its Bezier segments rather than its
   * sample points, so the line on screen is the line that is committed - the
   * samples would be a polygonal approximation of it.
   */
  function strokePath(graphPoints, segments, attributes) {
    if (Array.isArray(segments) && segments.length) {
      const d = [
        `M ${toScreen(segments[0].from).x.toFixed(2)} ${toScreen(segments[0].from).y.toFixed(2)}`,
        ...segments.map((segment) => {
          const c1 = toScreen(segment.control1);
          const c2 = toScreen(segment.control2);
          const to = toScreen(segment.to);

          return `C ${c1.x.toFixed(2)} ${c1.y.toFixed(2)} ${c2.x.toFixed(2)} ${c2.y.toFixed(2)} ${to.x.toFixed(2)} ${to.y.toFixed(2)}`;
        }),
      ].join(" ");

      return createSvgElement("path", { d, fill: "none", ...attributes });
    }

    return pathElement(graphPoints, attributes);
  }

  /*
   * A LOOKUP THAT WORKS IN BOTH BUILDS.
   *
   * In the browser the model module is the one the page loaded, and a function
   * added to it is there. A test bundle that loads the model twice (once for the
   * harness's global, once through the editor's import) can see the OLDER build
   * of a pure helper - so a reader falls back rather than throwing over a value
   * it can compute itself.
   */
  function niceStepOf(span) {
    return typeof enggMathModel.niceStep === "function"
      ? enggMathModel.niceStep(span, 10)
      : Math.max(span / 10, 1e-6);
  }

  /* The frame: axes, unnumbered grid, ticks and any plotted curves. */
  function drawFrame() {
    const group = createSvgElement("g", { class: "sketch-canvas-frame" });

    try {
      drawMathGraph({
        svg: group,
        parentSvg: svg,
        entity: previewGraph(),
        style: working.style,
        toScreen,
      });
    } catch (error) {
      /* A frame that cannot be drawn must not take the student's ink with it. */
      console.error("Graph frame could not be drawn", error);
    }
  }

  function drawStrokes() {
    const showRaw = view === "original" || view === "overlay";
    const showCorrected = view === "corrected" || view === "overlay";

    const rawLayer = createSvgElement("g", { class: "sketch-layer-raw" });
    const correctedLayer = createSvgElement("g", {
      class: "sketch-layer-corrected",
    });

    if (showRaw) {
      strokes.forEach((entry) => {
        const ink = pathElement(
          entry.original.length > 1 ? entry.original : entry.points,
          {
            class: "sketch-raw-stroke",
            stroke: "var(--datum-muted)",
            "stroke-width": 1.4,
            "stroke-linecap": "round",
            "stroke-linejoin": "round",
            "stroke-dasharray": view === "overlay" ? "4 3" : "none",
            opacity: view === "overlay" ? 0.65 : 1,
          },
        );

        if (ink) {
          rawLayer.appendChild(ink);
        }
      });
    }

    if (showCorrected) {
      correctedStrokes().forEach((entry) => {
        if (entry.points.length < 2) {
          return;
        }

        const ink = strokePath(entry.points, entry.segments, {
          class: "sketch-corrected-stroke",
          stroke: "var(--datum-green)",
          "stroke-width": 2.2,
          "stroke-linecap": "round",
          "stroke-linejoin": "round",
        });

        if (ink) {
          correctedLayer.appendChild(ink);
        }

        /*
         * THE STUDENT'S OWN STROKE, FAINTLY, BEHIND ITS CORRECTION.
         *
         * It is the "show my strokes" setting, and it is drawn only in the
         * Corrected view - the Overlay view already draws the raw strokes in
         * full, and drawing them twice there would make them look darker than
         * the correction rather than behind it.
         */
        if (view === "corrected" && showTrace && entry.original.length > 1) {
          const trace = pathElement(entry.original, {
            class: "sketch-trace-stroke",
            stroke: "var(--datum-muted)",
            "stroke-width": 1,
            "stroke-dasharray": "3 3",
            opacity: 0.4,
          });

          if (trace) {
            correctedLayer.appendChild(trace);
          }
        }
      });
    }

    svg.appendChild(rawLayer);
    svg.appendChild(correctedLayer);
  }

  function drawHandles() {
    const layer = createSvgElement("g", { class: "sketch-layer-handles" });

    points.forEach((entry, index) => {
      const at = toScreen(entry);
      const selected = entry.id === selectedPointId;

      const node = createSvgElement("g", {
        class: `sketch-handle${selected ? " is-selected" : ""}`,
        "data-sketch-handle": entry.id,
        transform: `translate(${at.x} ${at.y})`,
      });

      node.appendChild(
        createSvgElement("circle", {
          r: selected ? 7 : 5.5,
          class: "sketch-handle-ring",
          stroke: "var(--datum-green)",
          "stroke-width": selected ? 2.2 : 1.6,
          fill: "var(--datum-surface)",
        }),
      );

      node.appendChild(
        createSvgElement("circle", {
          r: 2,
          class: "sketch-handle-dot",
          fill: "var(--datum-green)",
          stroke: "none",
        }),
      );

      const label = createSvgElement("text", {
        x: 10,
        y: -9,
        class: "sketch-handle-label",
        "pointer-events": "none",
      });

      label.textContent = `${index + 1}: (${numberText(entry.x)}, ${numberText(entry.y)})`;

      node.appendChild(label);

      layer.appendChild(node);
    });

    /* The stroke in progress, as the student's ink. */
    if (drag?.kind === "stroke" && drag.samples.length > 1) {
      const live = pathElement(drag.samples, {
        class: "sketch-live-stroke",
        stroke: "var(--datum-ink)",
        "stroke-width": 1.6,
        "stroke-linecap": "round",
        opacity: 0.75,
      });

      if (live) {
        layer.appendChild(live);
      }
    }

    /* The eraser, so the student can see what it will take. */
    if (drag?.kind === "erase") {
      const at = toScreen(drag.last || { x: 0, y: 0 });

      layer.appendChild(
        createSvgElement("circle", {
          cx: at.x,
          cy: at.y,
          r: ERASER_PX,
          fill: "none",
          stroke: "var(--datum-error)",
          "stroke-width": 1.5,
          "stroke-dasharray": "3 3",
        }),
      );
    }

    svg.appendChild(layer);
  }

  function draw() {
    sizeCanvas();

    svg.textContent = "";

    drawFrame();
    drawStrokes();
    drawHandles();
  }

  /* ============================================================
   * THE INSPECTOR
   * ============================================================ */

  function renderPointList() {
    pointsList.textContent = "";

    points.forEach((entry, index) => {
      const row = document.createElement("div");

      row.className = `sketch-point-row${entry.id === selectedPointId ? " is-selected" : ""}`;
      row.setAttribute("role", "listitem");
      row.dataset.sketchPointRow = entry.id;

      const indexNode = document.createElement("span");

      indexNode.className = "sketch-point-index";
      indexNode.textContent = String(index + 1);

      const x = document.createElement("input");
      const y = document.createElement("input");

      [
        { input: x, key: "x", label: "X coordinate" },
        { input: y, key: "y", label: "Y coordinate" },
      ].forEach(({ input, key, label }) => {
        input.type = "number";
        input.step = "any";
        input.inputMode = "decimal";
        input.className = "sketch-point-input";
        input.value = numberText(entry[key]);
        input.dataset.sketchPointField = key;
        input.dataset.sketchPointId = entry.id;
        input.title = label;
        input.setAttribute("aria-label", `Point ${index + 1} ${label}`);
      });

      const remove = document.createElement("button");

      remove.type = "button";
      remove.className = "sketch-point-delete";
      remove.dataset.sketchPointDelete = entry.id;
      remove.title = `Delete point ${index + 1}`;
      remove.setAttribute("aria-label", `Delete point ${index + 1}`);
      remove.innerHTML = "&times;";

      row.append(indexNode, x, y, remove);
      pointsList.appendChild(row);
    });

    const count = dialog.querySelector("[data-sketch-point-count]");

    if (count) {
      count.textContent = points.length ? `${points.length}` : "none";
    }

    if (!points.length) {
      const empty = document.createElement("div");

      empty.className = "sketch-points-empty";
      empty.textContent =
        "Click the canvas with the Point tool to place an exact point.";
      pointsList.appendChild(empty);
    }

    const selected = selectedPoint();

    dialog.querySelectorAll("[data-sketch-selected-field]").forEach((input) => {
      const key = input.dataset.sketchSelectedField;

      input.disabled = !selected;
      input.value = selected ? numberText(selected[key]) : "";
    });

    pointsList
      .querySelector(`[data-sketch-point-row="${selectedPointId}"]`)
      ?.scrollIntoView?.({ block: "nearest" });
  }

  function renderControls() {
    dialog.querySelectorAll("[data-sketch-tool-draw], [data-sketch-tool-point], [data-sketch-tool-erase], [data-sketch-tool-select]").forEach((button) => {
      const id = toolIdOf(button);

      if (!id) {
        return;
      }

      const active = tool === id;

      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });

    dialog.querySelectorAll("[data-sketch-view]").forEach((button) => {
      const active = button.dataset.sketchView === view;

      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });

    const undoButton = dialog.querySelector("[data-sketch-undo]");
    const redoButton = dialog.querySelector("[data-sketch-redo]");

    if (undoButton) {
      undoButton.disabled = !history.past.length;
    }

    if (redoButton) {
      redoButton.disabled = !history.future.length;
    }

    const inspectorButton = dialog.querySelector("[data-sketch-inspector]");

    if (inspectorButton) {
      inspectorButton.classList.toggle("active", inspectorOpen);
      inspectorButton.setAttribute("aria-pressed", String(inspectorOpen));
    }

    dialog.querySelectorAll("[data-sketch-field]").forEach((input) => {
      const key = input.dataset.sketchField;

      if (document.activeElement === input) {
        return;
      }

      /*
       * THE FOUR BOUNDS SHOW THE RANGE IN FORCE - automatic or manual. A
       * student pressing Automatic sees, in the fields, exactly what the
       * calculation produced, so the two modes are never a mystery.
       */
      const value = BOUND_FIELDS.includes(key)
        ? currentBounds()[key]
        : working.geometry[key];

      /*
       * AN UNSET SETTING IS AN EMPTY BOX, NOT THE WORD null.
       *
       * `Number(null)` is 0, so a plain `Number.isFinite(Number(value))` test
       * passes a null spacing straight through as the string "null" - which the
       * browser refuses to put in a number input and logs a warning for on every
       * render. An unset spacing is blank, which is what it means.
       */
      input.value =
        value === null || value === undefined || !Number.isFinite(Number(value))
          ? ""
          : String(value);

      input.readOnly = false;
    });

    renderBoundsMode();

    dialog.querySelectorAll("[data-sketch-toggle-setting]").forEach((input) => {
      const key = input.dataset.sketchToggleSetting;

      if (key === "snap") {
        input.checked = snapEnabled;
      } else if (key === "straighten") {
        input.checked = straighten;
      } else if (key === "showTrace") {
        input.checked = showTrace;
      } else {
        input.checked = working.geometry[key] !== false;
      }
    });

    const strengthNode = dialog.querySelector("[data-sketch-strength]");

    if (strengthNode) {
      strengthNode.value = strength;
    }

    if (instructionNode) {
      instructionNode.textContent =
        tool === "erase"
          ? "Drag over a stroke to erase part of it"
          : INSTRUCTION;
    }

    if (hintNode) {
      hintNode.textContent =
        tool === "draw"
          ? "Drag to draw - stroke ends snap to your points"
          : tool === "point"
            ? "Click to place a point at an exact coordinate"
            : tool === "select"
              ? "Click or drag one of your points"
              : "";
    }
  }

  /* The four fields that are the coordinate space. */
  const BOUND_FIELDS = ["xMin", "xMax", "yMin", "yMax"];

  /*
   * HOW THE BOUNDS ARE SHOWN.
   *
   * The mode buttons say which mode is in force, the four fields always show the
   * range actually drawn, and the note says what happens next: automatic follows
   * the geometry, manual does not and reports what falls outside it.
   */
  function renderBoundsMode() {
    dialog.querySelectorAll("[data-sketch-bounds-mode]").forEach((button) => {
      const active = button.dataset.sketchBoundsMode === boundsMode;

      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });

    const label = dialog.querySelector("[data-sketch-bounds-mode-label]");

    if (label) {
      label.textContent = boundsMode === "auto" ? "Automatic" : "Manual";
    }

    const note = dialog.querySelector("[data-sketch-bounds-note]");

    if (note) {
      const outside = outOfBounds();

      if (boundsMode === "auto") {
        note.textContent = "The whole canvas is the coordinate space, calculated from your geometry.";
      } else if (outside.length) {
        note.textContent = `${outside.length} ${outside.length === 1 ? "item is" : "items are"} outside these bounds - they keep their coordinates but are not shown.`;
      } else {
        note.textContent = "Your own range, kept as typed. Geometry outside it is not moved.";
      }

      note.classList.toggle("is-warning", boundsMode === "manual" && outside.length > 0);
    }

    app.classList.toggle("bounds-manual", boundsMode === "manual");
  }



  function renderStatus() {
    const summary = enggSketchCorrection.correctionSummary(correctedStrokes());

    if (statusNode) {
      const parts = [];

      if (strokes.length) {
        parts.push(
          `${strokes.length} stroke${strokes.length === 1 ? "" : "s"}`,
        );
      }

      if (points.length) {
        parts.push(`${points.length} point${points.length === 1 ? "" : "s"}`);
      }

      statusNode.textContent = parts.join(" / ");
    }

    if (summaryNode) {
      const parts = [];

      if (summary.straightened) {
        parts.push(`${summary.straightened} straightened`);
      }

      if (summary.smoothed) {
        parts.push(`${summary.smoothed} smoothed`);
      }

      summaryNode.textContent = parts.join(", ");
    }

    if (readoutNode && !cursor) {
      readoutNode.textContent = "x -, y -";
    }
  }

  /*
   * THE ONE UPDATE.
   *
   * Every add, move, delete, correction change and undo comes through here, so
   * this is where the AUTOMATIC bounds are recalculated - once per change,
   * after the geometry has settled, and never in manual mode. Drawing, the
   * point table, the controls and the status all read the same state, so the
   * canvas, the inspector and the source cannot describe different ranges.
   */
  function refresh() {
    correctedCache = null;

    /*
     * THE RANGE DOES NOT MOVE UNDER A DRAG.
     *
     * In automatic mode the bounds follow the geometry - but not WHILE a point
     * is being dragged: rescaling the canvas mid-gesture moves the pixel the
     * student is dragging towards, and every frame would chase it. The range is
     * re-calculated once, when the drag ends.
     */
    if (!drag) {
      refitBounds();
    }

    draw();
    renderPointList();
    renderControls();
    renderStatus();
  }

  /* ============================================================
   * HIT TESTING
   * ============================================================ */

  /* The student's own point nearest a client position, within the grab radius. */
  function pointAt(clientX, clientY) {
    const box = canvasBox();

    if (!box) {
      return null;
    }

    let best = null;

    points.forEach((entry) => {
      const at = toScreen(entry);
      const distance = Math.hypot(
        at.x - (clientX - box.left),
        at.y - (clientY - box.top),
      );

      if (distance <= GRAB_PX && (!best || distance < best.distance)) {
        best = { point: entry, distance };
      }
    });

    return best?.point || null;
  }



  /* ============================================================
   * DRAWING A STROKE
   * ============================================================ */

  /*
   * A STROKE THAT STARTS ON ONE OF THE STUDENT'S POINTS IS PINNED TO IT.
   *
   * The correction must not pull a stroke's end off the point it began on -
   * otherwise two strokes drawn to meet at a placed point would cross it and
   * keep going. The pin is the point's own coordinates, not the press, so the
   * stroke meets the point exactly.
   */
  function beginStroke(at, pin = null) {
    drag = {
      kind: "stroke",
      pointerId: null,
      samples: [copyPoint(at)],
      screenStart: { ...at.screen },
      screenLast: { ...at.screen },
      moving: false,
      pinStart: pin ? copyPoint(pin) : null,
      pinEnd: null,
    };
  }

  function extendStroke(at) {
    if (!drag || drag.kind !== "stroke") {
      return;
    }

    const travel = Math.hypot(
      at.screen.x - drag.screenStart.x,
      at.screen.y - drag.screenStart.y,
    );

    if (!drag.moving) {
      if (travel < MIN_STROKE_PX) {
        return;
      }

      drag.moving = true;
    }

    const moved = Math.hypot(
      at.screen.x - drag.screenLast.x,
      at.screen.y - drag.screenLast.y,
    );

    if (moved < SAMPLE_PX) {
      return;
    }

    drag.samples.push(copyPoint(at));
    drag.screenLast = { ...at.screen };

    if (drag.samples.length > MAX_SAMPLES) {
      drag.samples.length = MAX_SAMPLES;
    }

    draw();
  }

  function finishStroke(release = null) {
    if (!drag || drag.kind !== "stroke") {
      return false;
    }

    const finished = drag;

    drag = null;

    /*
     * THE RELEASE IS THE STROKE'S LAST SAMPLE.
     *
     * A fast drag can end between two `pointermove`s, so the release carries
     * the final position the moves never reported. Using it (and only it, not
     * the moves' own end) is what makes the stroke finish exactly where the
     * student lifted - the graph coordinate of the release is the last point
     * stored, not one from an earlier move.
     */
    if (release) {
      const last = finished.samples[finished.samples.length - 1];

      if (
        !last ||
        Math.hypot(release.x - last.x, release.y - last.y) > 1e-9
      ) {
        finished.moving = true;
        finished.samples.push(copyPoint(release));
      }
    }

    if (!finished.moving || finished.samples.length < 2) {
      draw();

      return false;
    }

    /* Ending on one of the student's points pins the end to it. */
    const last = finished.samples[finished.samples.length - 1];
    const endScreen = toScreen(last);
    const pin = points.find((entry) => {
      const at = toScreen(entry);

      return Math.hypot(at.x - endScreen.x, at.y - endScreen.y) <= GRAB_PX;
    });

    const before = snapshot();

    strokes.push({
      id: nextStrokeId(),
      points: finished.samples.map(copyPoint),
      original: finished.samples.map(copyPoint),
      pinStart: finished.pinStart,
      pinEnd: pin ? copyPoint(pin) : null,
    });

    record(before);
    refresh();

    return true;
  }

  /* ============================================================
   * ERASING
   * ============================================================ */

  function eraseAt(graphPoint) {
    const reach = unitsForPixels(ERASER_PX);

    const remaining = [];

    strokes.forEach((entry) => {
      const runs = [];
      let current = [];

      entry.points.forEach((point) => {
        const hit =
          Math.hypot(point.x - graphPoint.x, point.y - graphPoint.y) <= reach;

        if (hit) {
          if (current.length) {
            runs.push(current);
          }

          current = [];

          return;
        }

        current.push(point);
      });

      if (current.length) {
        runs.push(current);
      }

      runs.forEach((run, index) => {
        if (run.length < 2) {
          return;
        }

        const length = run.reduce(
          (total, point, at) =>
            at === 0
              ? 0
              : total +
                Math.hypot(point.x - run[at - 1].x, point.y - run[at - 1].y),
          0,
        );

        if (
          unitsForPixels(MIN_RUN_PX) > 0 &&
          length < unitsForPixels(MIN_RUN_PX)
        ) {
          return;
        }

        remaining.push({
          id: `${entry.id}-${index}`,
          points: run.map(copyPoint),
          original: run.map(copyPoint),
        });
      });
    });

    strokes.length = 0;
    strokes.push(...remaining);
  }

  /* ============================================================
   * POINT EDITING
   * ============================================================ */

  function addPointAt(graphPoint) {
    const snapped = snapPoint(graphPoint);

    const before = snapshot();

    const entry = {
      id: nextPointId(),
      x: Number(snapped.x.toFixed(6)),
      y: Number(snapped.y.toFixed(6)),
    };

    points.push(entry);
    selectedPointId = entry.id;

    record(before);
    refresh();

    return entry;
  }

  function addPointEntry() {
    const before = snapshot();

    /* A new point goes on the origin, the one place every graph has. */
    const target = snapPoint({ x: 0, y: 0 });

    const entry = {
      id: nextPointId(),
      x: Number(target.x.toFixed(6)),
      y: Number(target.y.toFixed(6)),
    };

    points.push(entry);
    selectedPointId = entry.id;

    record(before);
    refresh();

    dialog
      .querySelector(`[data-sketch-point-row="${entry.id}"] input`)
      ?.select?.();

    return entry;
  }

  function removePoint(id) {
    const index = points.findIndex((entry) => entry.id === id);

    if (index < 0) {
      return false;
    }

    const before = snapshot();

    points.splice(index, 1);

    if (selectedPointId === id) {
      selectedPointId = points[Math.min(index, points.length - 1)]?.id || null;
    }

    record(before);
    refresh();

    return true;
  }

  function movePointOrder(id, delta) {
    const index = points.findIndex((entry) => entry.id === id);

    if (index < 0) {
      return false;
    }

    const to = Math.max(0, Math.min(points.length - 1, index + delta));

    if (to === index) {
      return false;
    }

    const before = snapshot();

    const [entry] = points.splice(index, 1);

    points.splice(to, 0, entry);

    record(before);
    refresh();

    return true;
  }

  /*
   * A TYPED COORDINATE, OR NOTHING.
   *
   * A field the student is still typing in is not a number, and is left exactly
   * as it is: nothing is committed for it and the sketch keeps the last valid
   * value. That is what "invalid input must not corrupt the sketch" means in a
   * number box.
   */
  function setPointCoordinate(id, key, text) {
    const entry = pointById(id);

    if (!entry) {
      return false;
    }

    const value = Number(text);

    if (!Number.isFinite(value) || String(text).trim() === "") {
      return false;
    }

    if (entry[key] === value) {
      return true;
    }

    const before = snapshot();

    entry[key] = value;

    record(before);
    draw();
    renderStatus();

    return true;
  }

  /* ============================================================
   * POINTER ROUTING
   * ============================================================ */

  function pointerPosition(event) {
    return clientToGraph(event.clientX, event.clientY);
  }

  /*
   * THE MIDDLE BUTTON PANS.
   *
   * It is kept because every other canvas in DAETUM accepts it, and a
   * middle-drag that silently started drawing would be worse than no pan at all.
   * Panning is a CHANGE OF BOUNDS - it takes the range with it - and it is never
   * a document change, so it is not in the undo history.
   */
  function isPanPress(event) {
    return event.button === 1;
  }

  svg.addEventListener("pointerdown", (event) => {
    if (isPanPress(event)) {
      event.preventDefault();

      svg.setPointerCapture?.(event.pointerId);

      drag = {
        kind: "pan",
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
      };

      svg.classList.add("is-panning");

      return;
    }

    if (event.button !== undefined && event.button !== 0) {
      return;
    }

    event.preventDefault();

    const at = pointerPosition(event);

    if (!at) {
      return;
    }

    svg.setPointerCapture?.(event.pointerId);

    if (tool === "erase") {
      drag = {
        kind: "erase",
        pointerId: event.pointerId,
        last: copyPoint(at),
        before: snapshot(),
      };

      eraseAt(at);
      draw();

      return;
    }

    if (
      tool === "select" ||
      (tool === "draw" && pointAt(event.clientX, event.clientY))
    ) {
      const hit = pointAt(event.clientX, event.clientY);

      if (hit) {
        selectedPointId = hit.id;

        drag = {
          kind: "move",
          pointerId: event.pointerId,
          pointId: hit.id,
          before: snapshot(),
        };

        refresh();

        return;
      }

      if (tool === "select") {
        selectedPointId = null;
        refresh();

        return;
      }
    }

    if (tool === "point") {
      addPointAt(at);

      return;
    }

    beginStroke(at, pointAt(event.clientX, event.clientY));
  });

  svg.addEventListener("pointermove", (event) => {
    const at = pointerPosition(event);

    if (at) {
      cursor = at;

      if (readoutNode) {
        readoutNode.textContent = `x ${numberText(snapPoint(at).x)}, y ${numberText(snapPoint(at).y)}`;
      }
    }

    if (!drag) {
      return;
    }

    if (drag.kind === "pan") {
      panBy(event.clientX - drag.x, event.clientY - drag.y);

      drag.x = event.clientX;
      drag.y = event.clientY;

      draw();

      return;
    }

    if (drag.kind === "stroke") {
      if (at) {
        extendStroke(at);
      }

      return;
    }

    if (drag.kind === "move") {
      if (!at) {
        return;
      }

      const entry = pointById(drag.pointId);

      if (!entry) {
        return;
      }

      const snapped = snapPoint(at);

      const nextX = Number(snapped.x.toFixed(6));
      const nextY = Number(snapped.y.toFixed(6));

      if (entry.x !== nextX || entry.y !== nextY) {
        drag.moved = true;
      }

      entry.x = nextX;
      entry.y = nextY;

      correctedCache = null;
      draw();
      renderPointList();
      renderStatus();

      return;
    }

    if (drag.kind === "erase" && at) {
      drag.last = copyPoint(at);

      eraseAt(at);
      draw();
    }
  });

  function endPointer(event) {
    if (svg.hasPointerCapture?.(event.pointerId)) {
      svg.releasePointerCapture(event.pointerId);
    }

    if (!drag) {
      return;
    }

    const kind = drag.kind;

    if (kind === "pan") {
      drag = null;
      svg.classList.remove("is-panning");
      draw();

      return;
    }

    if (kind === "stroke") {
      finishStroke(clientToGraph(event.clientX, event.clientY));

      return;
    }

    if (kind === "move") {
      const before = drag.before;
      const moved = drag.moved === true;

      drag = null;

      /*
       * A PRESS THAT NEVER MOVED IS A SELECTION, NOT AN EDIT. Recording it would
       * put an undo step in the history that changes nothing - so Undo would
       * appear to do nothing at all, once per click.
       */
      if (moved) {
        record(before);
      }

      refresh();

      return;
    }

    if (kind === "erase") {
      const before = drag.before;

      drag = null;
      record(before);
      refresh();
    }
  }

  svg.addEventListener("pointerup", (event) => {
    event.preventDefault();
    endPointer(event);
  });

  svg.addEventListener("pointercancel", (event) => {
    if (drag?.kind === "erase" || drag?.kind === "move") {
      restore(drag.before);
    }

    drag = null;
    svg.classList.remove("is-panning");
    refresh();
    void event;
  });

  /*
   * THE WHEEL ZOOMS THE COORDINATE SPACE.
   *
   * Because the bounds ARE the canvas, a zoom is a shrinking or growing RANGE:
   * the span is multiplied about the coordinate under the pointer, so that
   * coordinate stays under it. Ctrl+wheel is what a trackpad sends for a zoom
   * gesture and a plain wheel is what a mouse sends; both zoom here, because
   * the canvas has no scrolling of its own.
   */
  svg.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();

      const box = canvasBox();
      const anchor = clientToGraph(event.clientX, event.clientY);

      if (!box || !anchor) {
        return;
      }

      const factor = Math.min(4, Math.max(0.25, Math.exp(event.deltaY * 0.0015)));

      const bounds = currentBounds();

      const span = {
        x: (bounds.xMax - bounds.xMin) * factor,
        y: (bounds.yMax - bounds.yMin) * factor,
      };

      const ratioX =
        (anchor.x - bounds.xMin) / Math.max(bounds.xMax - bounds.xMin, 1e-12);
      const ratioY =
        (bounds.yMax - anchor.y) / Math.max(bounds.yMax - bounds.yMin, 1e-12);

      const next = {
        xMin: anchor.x - span.x * ratioX,
        xMax: anchor.x + span.x * (1 - ratioX),
        yMin: anchor.y - span.y * (1 - ratioY),
        yMax: anchor.y + span.y * ratioY,
      };

      boundsMode = "manual";
      manualBounds = { ...next };
      settledBounds = enggMathGraphBounds.resolveBounds({
        mode: "manual",
        bounds: manualBounds,
        fallback: settledBounds,
      });

      renderBoundsMode();
      renderControls();
      draw();
    },
    { passive: false },
  );

  svg.addEventListener("pointerleave", () => {
    cursor = null;

    if (readoutNode) {
      readoutNode.textContent = "x -, y -";
    }
  });

  /* ============================================================
   * THE CONTROLS
   * ============================================================ */

  function setTool(next) {
    if (!["draw", "point", "erase", "select"].includes(next)) {
      return;
    }

    /* Switching tool finishes what is in progress rather than dropping it. */
    if (drag?.kind === "stroke") {
      finishStroke();
    }

    drag = null;
    tool = next;

    svg.classList.toggle("is-erase", tool === "erase");
    svg.classList.toggle("is-point", tool === "point");
    svg.classList.toggle("is-move", tool === "select");

    renderControls();
  }

  function setView(next) {
    if (!["original", "corrected", "overlay"].includes(next)) {
      return;
    }

    view = next;
    refresh();
  }

  /*
   * THE TOOL BUTTONS, BY THEIR OWN ATTRIBUTE.
   *
   * Each is `data-sketch-tool-draw` and so on, so a test and the help text name
   * the same control the handler does. `dataset.sketchToolDraw` is that
   * attribute's DOM name; a tool id is its suffix.
   */
  function toolIdOf(button) {
    for (const attribute of button.attributes) {
      if (attribute.name.startsWith("data-sketch-tool-")) {
        return attribute.name.replace("data-sketch-tool-", "");
      }
    }

    return null;
  }

  dialog.querySelectorAll(".sketch-tool").forEach((button) => {
    const id = toolIdOf(button);

    if (!id) {
      return;
    }

    if (!["draw", "point", "erase", "select"].includes(id)) {
      return;
    }

    button.addEventListener("click", () => setTool(id));
  });

  dialog.querySelectorAll("[data-sketch-view]").forEach((button) => {
    button.addEventListener("click", () => setView(button.dataset.sketchView));
  });

  dialog.querySelector("[data-sketch-undo]")?.addEventListener("click", () => {
    undo();
  });

  dialog.querySelector("[data-sketch-redo]")?.addEventListener("click", () => {
    redo();
  });

  dialog
    .querySelector("[data-sketch-inspector]")
    ?.addEventListener("click", () => {
      inspectorOpen = !inspectorOpen;
      app.classList.toggle("inspector-collapsed", !inspectorOpen);
      renderControls();
      scheduleDraw();
    });

  /*
   * FIT: BACK TO AUTOMATIC BOUNDS.
   *
   * It is not a geometry edit. It returns the range to the calculation, which is
   * what undoes a zoom, a pan or a manual range - and it is the way back from
   * Manual without typing four numbers by hand.
   */
  dialog.querySelector("[data-sketch-fit]")?.addEventListener("click", () => {
    fitBounds();
  });

  pointsList.addEventListener("click", (event) => {
    const remove = event.target.closest?.("[data-sketch-point-delete]");

    if (remove) {
      event.preventDefault();
      removePoint(remove.dataset.sketchPointDelete);

      return;
    }

    const row = event.target.closest?.("[data-sketch-point-row]");

    if (row && !event.target.closest?.("input")) {
      selectedPointId = row.dataset.sketchPointRow;
      refresh();
    }
  });

  pointsList.addEventListener("input", (event) => {
    const input = event.target.closest?.("[data-sketch-point-field]");

    if (!input) {
      return;
    }

    const id = input.dataset.sketchPointId;
    const key = input.dataset.sketchPointField;

    selectedPointId = id;

    /*
     * THE FIELD IS NOT REBUILT WHILE THE STUDENT TYPES. Re-rendering the table
     * on every keystroke would put a fresh input under the cursor and make a
     * decimal point impossible to type; only the canvas and the status change.
     */
    setPointCoordinate(id, key, input.value);

    dialog.querySelectorAll("[data-sketch-selected-field]").forEach((other) => {
      const otherKey = other.dataset.sketchSelectedField;
      const entry = pointById(id);

      if (!entry || selectedPointId !== id) {
        return;
      }

      other.value = numberText(entry[otherKey]);
    });

    draw();
  });

  dialog.querySelectorAll("[data-sketch-selected-field]").forEach((input) => {
    input.addEventListener("input", () => {
      if (!selectedPointId) {
        return;
      }

      const key = input.dataset.sketchSelectedField;

      setPointCoordinate(selectedPointId, key, input.value);

      const row = pointsList.querySelector(
        `[data-sketch-point-row="${selectedPointId}"] [data-sketch-point-field="${key}"]`,
      );

      const entry = pointById(selectedPointId);

      if (row && entry) {
        row.value = numberText(entry[key]);
      }
    });
  });

  dialog
    .querySelector("[data-sketch-point-add]")
    ?.addEventListener("click", () => {
      addPointEntry();
    });

  dialog
    .querySelector("[data-sketch-point-remove]")
    ?.addEventListener("click", () => {
      if (selectedPointId) {
        removePoint(selectedPointId);
      }
    });

  dialog
    .querySelector("[data-sketch-point-up]")
    ?.addEventListener("click", () => {
      if (selectedPointId) {
        movePointOrder(selectedPointId, -1);
      }
    });

  dialog
    .querySelector("[data-sketch-point-down]")
    ?.addEventListener("click", () => {
      if (selectedPointId) {
        movePointOrder(selectedPointId, 1);
      }
    });

  /*
   * A SETTING IS A SETTING, NOT A GEOMETRY EDIT.
   *
   * Changing the range, the grid or the smoothing changes how the sketch is
   * drawn and corrected - never the numbers that were drawn. So none of them is
   * recorded in the undo history, and none of them can lose a stroke.
   */
  dialog.querySelectorAll("[data-sketch-field]").forEach((input) => {
    const key = input.dataset.sketchField;

    input.addEventListener("change", () => {
      /* A FIELD LEFT HALF-TYPED REVERTS TO WHAT IS IN FORCE. */
      if (BOUND_FIELDS.includes(key)) {
        input.value = String(currentBounds()[key]);
      }
    });

    input.addEventListener("input", () => {
      const value = Number(input.value);

      if (!Number.isFinite(value) || String(input.value).trim() === "") {
        return;
      }

      /*
       * A TYPED BOUND IS THE STUDENT'S RANGE.
       *
       * The first edit switches to MANUAL, so the next stroke they draw
       * cannot silently rescale the graph they have just framed. The value is
       * checked against the OTHER three in force, so a crossed range is refused
       * at the keystroke and the last valid range stays on screen.
       */
      if (BOUND_FIELDS.includes(key)) {
        const inForce = { ...currentBounds(), ...(manualBounds || {}) };

        const next = { ...inForce, [key]: value };

        const xSpan = next.xMax - next.xMin;
        const ySpan = next.yMax - next.yMin;

        /* A bound crossed past its partner is not a range; it is a typo. */
        if (!(xSpan > 0) || !(ySpan > 0)) {
          return;
        }

        if (value === 0 && (key === "xMin" || key === "yMin")) {
          /* A range of -inf..0 is refused by the span test already. */
          return;
        }

        boundsMode = "manual";
        manualBounds = { ...next, [key]: value };
        settledBounds = enggMathGraphBounds.resolveBounds({
          mode: "manual",
          bounds: manualBounds,
          fallback: settledBounds,
        });

        renderBoundsMode();

        dialog.querySelectorAll("[data-sketch-field]").forEach((other) => {
          const otherKey = other.dataset.sketchField;

          if (other !== input && BOUND_FIELDS.includes(otherKey)) {
            other.value = String(settledBounds[otherKey]);
          }
        });

        draw();
        renderStatus();

        return;
      }

      if (
        (key === "xTickSpacing" || key === "yTickSpacing") &&
        !(value > 0) &&
        value !== 0
      ) {
        return;
      }

      working.geometry[key] = value;

      refresh();
    });
  });

  /* THE MODE BUTTONS: Automatic calculates, Manual keeps what is shown. */
  dialog.querySelectorAll("[data-sketch-bounds-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      const next = button.dataset.sketchBoundsMode;

      if (next === "auto") {
        fitBounds();

        return;
      }

      if (!BOUND_FIELDS.every((key) => Number.isFinite(currentBounds()[key]))) {
        return;
      }

      boundsMode = "manual";
      manualBounds = { ...currentBounds() };

      renderBoundsMode();
      renderControls();
      draw();
    });
  });

  dialog
    .querySelector("[data-sketch-strength]")
    ?.addEventListener("change", (event) => {
      strength = event.target.value;
      refresh();
    });

  dialog.querySelectorAll("[data-sketch-toggle-setting]").forEach((input) => {
    input.addEventListener("change", () => {
      const key = input.dataset.sketchToggleSetting;

      if (key === "snap") {
        snapEnabled = input.checked;
        renderControls();

        return;
      }

      if (key === "straighten") {
        straighten = input.checked;
        refresh();

        return;
      }

      if (key === "showTrace") {
        showTrace = input.checked;
        refresh();

        return;
      }

      working.geometry[key] = input.checked;

      refresh();
    });
  });

  /* Keyboard, on the editor rather than the canvas so a focused field still works. */
  dialog.addEventListener("keydown", (event) => {
    const inField = Boolean(event.target.closest?.("input, select"));

    /* Space must not scroll the page while the canvas has the key. */
    if (event.code === "Space" && !inField) {
      event.preventDefault();

      return;
    }

    /* A keyboard zoom about the canvas centre: + and - zoom, 0 fits. */
    if (!inField && !event.ctrlKey && !event.metaKey) {
      if (event.key === "+" || event.key === "=" || event.key === "-") {
        const box = canvasBox();
        const bounds = currentBounds();
        const factor = event.key === "-" ? 1.2 : 1 / 1.2;

        if (box) {
          const centreX = (bounds.xMin + bounds.xMax) / 2;
          const centreY = (bounds.yMin + bounds.yMax) / 2;

          const halfX = ((bounds.xMax - bounds.xMin) / 2) * factor;
          const halfY = ((bounds.yMax - bounds.yMin) / 2) * factor;

          boundsMode = "manual";
          manualBounds = {
            xMin: centreX - halfX,
            xMax: centreX + halfX,
            yMin: centreY - halfY,
            yMax: centreY + halfY,
          };

          settledBounds = { ...manualBounds };

          renderBoundsMode();
          renderControls();
          draw();
        }

        event.preventDefault();

        return;
      }

      if (event.key === "0") {
        fitBounds();
        event.preventDefault();

        return;
      }
    }

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      event.shiftKey ? redo() : undo();

      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();

      if (drag) {
        if (drag.kind === "erase" || drag.kind === "move") {
          restore(drag.before);
        }

        drag = null;
        refresh();

        return;
      }

      cancel();

      return;
    }

    if (inField) {
      if (
        event.key === "Delete" &&
        event.target.closest("[data-sketch-point-row]") &&
        selectedPointId
      ) {
        removePoint(selectedPointId);
      }

      return;
    }

    const key = event.key.toLowerCase();

    if (key === "d") {
      setTool("draw");
    } else if (key === "p") {
      setTool("point");
    } else if (key === "e") {
      setTool("erase");
    } else if (key === "s") {
      setTool("select");
    } else if (event.key === "Delete" && selectedPointId) {
      removePoint(selectedPointId);
    }
  });

  /* ============================================================
   * RESPONSIVE
   * ============================================================ */

  let resizeObserver = null;
  let drawFrameRequest = null;
  let wasNarrow = false;

  function scheduleDraw() {
    if (drawFrameRequest !== null) {
      return;
    }

    drawFrameRequest =
      typeof requestAnimationFrame === "function"
        ? requestAnimationFrame(() => {
            drawFrameRequest = null;
            draw();
          })
        : setTimeout(() => {
            drawFrameRequest = null;
            draw();
          }, 0);
  }

  function applyNarrowLayout() {
    /*
     * WHEN SPACE IS SHORT THE INSPECTOR FOLDS rather than the graph shrinking.
     * The graph keeps every pixel the toolbar and footer leave it, and the
     * inspector becomes a toggle the student can still open. The narrow class
     * also moves the tool labels out and leaves the icons, which is what makes
     * the toolbar fit one row.
     */
    const narrow =
      typeof globalThis.matchMedia === "function"
        ? globalThis.matchMedia(NARROW_QUERY).matches
        : typeof globalThis.innerWidth === "number"
          ? globalThis.innerWidth < 900
          : false;

    app.classList.toggle("is-narrow", narrow);

    /*
     * FOLD ONCE, ON BECOMING NARROW - not on every check. A student who reopens
     * the inspector on a small window keeps it open: the layout adapts to the
     * window, and the student's choice stands until the window changes size.
     */
    if (narrow && !wasNarrow && inspectorOpen) {
      inspectorOpen = false;
      app.classList.add("inspector-collapsed");
      renderControls();
    }

    wasNarrow = narrow;

    scheduleDraw();
  }

  const mediaQuery =
    typeof globalThis.matchMedia === "function"
      ? globalThis.matchMedia(NARROW_QUERY)
      : null;

  if (mediaQuery?.addEventListener) {
    mediaQuery.addEventListener("change", applyNarrowLayout);
  }



  if (typeof ResizeObserver === "function") {
    resizeObserver = new ResizeObserver(() => scheduleDraw());
    resizeObserver.observe(stage);
  }

  globalThis.addEventListener?.("resize", scheduleDraw);

  /*
   * THE STATS, AND WHY AN EDITOR EXPOSES THEM.
   *
   * A test can see whether a path exists; it cannot see WHICH representation
   * that path is, nor that resizing left the canonical geometry alone. So the
   * editor publishes its canonical numbers - limits, the student's points, the
   * correction's shape per stroke, the history depth - on the dialog element,
   * where a test reads them the way a user reads the canvas. They are derived
   * from the same state the drawing is, never from a copy.
   */
  function stats() {
    const built = correctedStrokes();

    return {
      view,
      tool,
      strength,
      straighten,
      /*
       * THE BOUNDS ARE THE COORDINATE SPACE - published as they are drawn, with
       * the mode that produced them, so a test can hold the whole editor to one
       * mapping: `limits`, `origin` and `mapping` all come from these numbers.
       */
      limits: currentBounds(),
      boundsMode,
      manualBounds: manualBounds ? { ...manualBounds } : null,
      outside: outOfBounds(),
      origin: mappingOrigin(),
      /*
       * THE FRAME'S OWN MAPPING, published so a test (and the inspector) can
       * see the same rectangle the axes, grid and pointers are placed from.
       */
      mapping: mappingSummary(),
      points: points.map((entry) => ({ ...entry })),
      strokes: strokes.map((entry) => entry.points.length),
      corrected: built.map((entry) => ({
        kind: entry.correction?.kind || "curve",
        points: entry.points.map((point) => ({ ...point })),
        segments: entry.segments.length,
      })),
      history: { past: history.past.length, future: history.future.length },
      canvas: canvasBox(),
    };
  }

  /* ============================================================
   * APPLY AND CANCEL
   * ============================================================ */

  /*
   * WHERE A NEW SKETCH LANDS IN THE DOCUMENT, BEFORE THE STUDENT PLACES IT.
   *
   * The graph is committed with ITS OWN LIMITS - xMin..xMax and yMin..yMax as
   * the student set them - so a graph coordinate means the same number in the
   * editor and on the sheet: a stroke drawn through (2, 3) is written through
   * (2, 3). No re-fitting to -5..5 happens on Apply, which is what used to make
   * the committed curve disagree with the axes it was drawn against.
   *
   * The offset is the translation from the editor's own graph coordinates into
   * drawing units of the placed box, and its scale is the SINGLE scale of both
   * axes - the box is sized from the limits (`sketchPlotBox`), so x and y
   * already share a unit and nothing is stretched.
   */
  function resultFor(offset) {
    return {
      strokes: correctedGraphFunctions(offset).map((component) => ({
        points: component.points,
        segments: component.segments,
        original: component.originalTrace,
        correction: component.correction,
        showOriginalTrace: showTrace,
      })),
      geometry: {
        ...working.geometry,
        mode: "sketch",
        showTickLabels: false,
        points: points.map((entry) => ({ ...entry })),
        /*
         * THE RANGE IN FORCE, AND THE MODE IT CAME FROM. A manual range is
         * committed as it was typed; an automatic one is committed as it was
         * calculated - and the mode travels with it so reopening the graph
         * knows whether to follow its geometry or keep its numbers.
         */
        xMin: currentBounds().xMin,
        xMax: currentBounds().xMax,
        yMin: currentBounds().yMin,
        yMax: currentBounds().yMax,
        yRangeExplicit: true,
        boundsMode,
        manualBounds: boundsMode === "manual" ? { ...currentBounds() } : null,
        xTickSpacing: working.geometry.xTickSpacing,
        yTickSpacing: working.geometry.yTickSpacing,
        showGrid: working.geometry.showGrid,
        showXAxis: working.geometry.showXAxis,
        showYAxis: working.geometry.showYAxis,
        equalUnits: working.geometry.equalUnits,
        gridDivisions: working.geometry.gridDivisions,
      },
      style: { ...working.style },
    };
  }

  const cancel = () => {
    teardown();
    close();
    options.onCancel?.();
  };

  dialog.querySelector("[data-sketch-apply]").addEventListener("click", () => {
    if (!strokes.length && !points.length) {
      if (statusNode) {
        statusNode.textContent =
          "Draw a line or place a point first, then Apply";
      }

      return;
    }

    /*
     * THE COMMITTED GEOMETRY IS THE PREVIEWED GEOMETRY.
     *
     * The corrected strokes are in the editor's graph coordinates. A new sketch is
     * translated by the placement offset its own box implies; an edited graph is
     * committed in place, so it is mapped with no offset at all. Either way the
     * numbers come from the cached correction, never from a second pass.
     */
    const existing = Boolean(graph?.id);
    const offset = existing
      ? { dx: 0, dy: 0, scale: 1 }
      : previewPlacementOffset();

    const result = resultFor(offset);

    teardown();
    close();

    options.onApply?.(result);
  });

  /*
   * THE PLACED GRAPH'S BOX, from its own limits.
   *
   * One drawing unit is the same length on both axes, so the box's plot area
   * has the limits' aspect ratio and both axes share one scale.
   */
  function sketchPlotBox(limits, unitSize = 18) {
    const inset = enggMathModel.GRAPH_INSET;
    const plotShareX = 1 - inset.left - inset.right;
    const plotShareY = 1 - inset.top - inset.bottom;

    return {
      width: Math.max(
        enggMathModel.MIN_GRAPH_SIDE,
        ((limits.xMax - limits.xMin) * unitSize) / plotShareX,
      ),
      height: Math.max(
        enggMathModel.MIN_GRAPH_SIDE,
        ((limits.yMax - limits.yMin) * unitSize) / plotShareY,
      ),
    };
  }

  function previewPlacementOffset() {
    const limits = currentBounds();

    /*
     * THE PLACED BOX HOLDS THE STUDENT'S OWN LIMITS. A target only supplies a
     * place on the page, never a range: taking its limits would commit a graph
     * of, say, -10..5 as a graph of -5..5 and silently move the numbers.
     */
    const xMin = limits.xMin;
    const xMax = limits.xMax;
    const yMin = limits.yMin;
    const yMax = limits.yMax;

    const box = sketchPlotBox({ xMin, xMax, yMin, yMax });

    /*
     * THE BOX IS THE SIZE THE LIMITS IMPLY, not the size of a draft box: the
     * preview maps the student's numbers into the box the commit will build, so
     * the curve that lands is the curve that was drawn.
     */
    const boxWidth = box.width;
    const boxHeight = box.height;

    const inset = enggMathModel.GRAPH_INSET;
    const plotWidth = boxWidth * (1 - inset.left - inset.right);
    const plotHeight = boxHeight * (1 - inset.top - inset.bottom);

    const scale = Math.min(
      plotWidth / Math.max(xMax - xMin, 1e-9),
      plotHeight / Math.max(yMax - yMin, 1e-9),
    );

    const left = boxWidth * inset.left;
    const bottom = boxHeight * inset.bottom;

    return {
      scale,
      dx: left - xMin * scale,
      dy: bottom - yMin * scale,
    };
  }

  dialog.querySelectorAll("[data-sketch-cancel]").forEach((button) => {
    button.addEventListener("click", cancel);
  });

  function teardown() {
    resizeObserver?.disconnect();
    globalThis.removeEventListener?.("resize", scheduleDraw);

    if (mediaQuery?.removeEventListener) {
      mediaQuery.removeEventListener("change", applyNarrowLayout);
    }
  }

  openDialog = dialog;
  closeCurrent = cancel;

  /*
   * THE CANONICAL STATE IS ATTACHED FIRST.
   *
   * Everything below can fail - a layout measurement, a paint - and when it
   * does, the dialog is already in the document and the student sees it. The
   * state hook going on BEFORE the first layout means an editor that failed to
   * paint is still inspectable (its bounds, its points, its history) rather than
   * being an element nobody can read. It is derived from the live state, so it is
   * correct the moment the paint succeeds.
   */
  const attachState = () => {
    dialog.__datumSketch = {
      stats,
      result: () => resultFor(previewPlacementOffset()),
      refresh,
    };
  };

  attachState();

  /*
   * THE FIRST LAYOUT IS MEASURED, NOT ASSUMED. The dialog is in the document by
   * now, so its canvas has a real box; the canvas is sized from it before the
   * first draw, which is why the graph opens filling the stage rather than at a
   * nominal size.
   */
  try {
    applyNarrowLayout();
    sizeCanvas();
    refresh();

    /* Restated after the first paint, so a reopen cannot leave a stale object. */
    attachState();
  } catch (error) {
    /*
     * A PAINT FAILURE MUST NOT LEAVE A BLANK MODAL. The editor is open and the
     * student is looking at it; the problem is reported, the hook above still
     * describes the state, and the canvas can be redrawn by the next event.
     */
    console.error("The graph sketch editor could not complete its first draw", error);
  }

  dialog.querySelector(".sketch-app-title")?.focus?.();

  return dialog;
}

/* ============================================================
 * PLACEMENT
 * ============================================================
 *
 * Apply does not commit. It hands the finished graph to the shared placement
 * session, which is what lets the student choose where it goes - and what makes
 * the preview under the cursor the geometry that lands.
 */
export function beginSketchPlacement(result, options = {}) {
  if (!result) {
    return false;
  }

  const geometry = result.geometry || {};

  const strokes = (result.strokes || [])
    .filter(
      (stroke) => Array.isArray(stroke.points) && stroke.points.length > 1,
    )
    .map((stroke) => ({
      points: stroke.points,
      segments: stroke.segments || [],
      correction: stroke.correction || null,
    }));

  /*
   * THE PLACEMENT FOLLOWS THE GRAPH'S BOX, not its ink. A sketch whose strokes
   * sit in one corner would otherwise be placed by its ink and land somewhere
   * the student did not aim at; the box is what the commit creates.
   */
  const calibration = enggGridPlacement.graphCalibration({
    geometry: {
      ...geometry,
      showXAxis: geometry.showXAxis !== false,
      showYAxis: geometry.showYAxis !== false,
    },
  });

  const outline = [
    { x: geometry.position?.x || 0, y: geometry.position?.y || 0 },
    {
      x: (geometry.position?.x || 0) + (Number(geometry.width) || 200),
      y: geometry.position?.y || 0,
    },
    {
      x: (geometry.position?.x || 0) + (Number(geometry.width) || 200),
      y: (geometry.position?.y || 0) + (Number(geometry.height) || 200),
    },
    {
      x: geometry.position?.x || 0,
      y: (geometry.position?.y || 0) + (Number(geometry.height) || 200),
    },
  ];

  return enggPlacementSession.beginPlacement(
    {
      strokes: strokes.length ? strokes : [{ points: outline }],
      calibration,
    },
    {
      commit: (placement) => {
        options.onCommit?.(placement);
      },
      cancel: () => {
        options.onCancelPlacement?.();
      },
    },
  );
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
  beginSketchPlacement,
  isSketchEditorOpen,
  closeSketchEditor,
};

export default enggMathSketchEditor;

/* Referenced so the module's own state is reachable from a test. */
export const _internal = {
  workingCopy,
  strokesOf,
};

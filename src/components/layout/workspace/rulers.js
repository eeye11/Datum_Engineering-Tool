/*
 * ============================================================
 * THE MEASUREMENT RULERS: TOP AND RIGHT EDGES OF THE SHEET
 * ============================================================
 *
 * A ruler along the top edge and another turned on its side along the right
 * edge, reading the DRAWING's own coordinates - the same units the grid, the
 * dimension tools and the Features panel use - so a student can estimate how
 * big the drawing is and where an object sits on the sheet.
 *
 * WHY THEY LIVE INSIDE THE CANVAS.
 *
 * The rulers are absolutely positioned children of `.drawing-canvas`, above and
 * to the right of the sheet. That single decision is what keeps them aligned:
 * the canvas element is the frame every screen coordinate in the editor is
 * measured against (`drawingCanvas.getBoundingClientRect()`), so a ruler whose
 * origin IS the canvas's origin cannot drift from the drawing when the window
 * resizes, a panel is closed or the page scrolls. Nothing has to undo a scroll
 * offset - there is only ever an offset of zero.
 *
 * They do not take a row of the workspace grid and they do not overlap the
 * drawing area in the sense that matters: they are marked
 * `pointer-events: none`, so a press over the ruler reaches the canvas below
 * exactly as it did before. Drawing, selection, dragging, snapping and every
 * gesture are untouched.
 *
 * WHAT IS BEING MEASURED.
 *
 * Millimetres. DAETUM's coordinates ARE millimetres - the saved source declares
 * `[x=1mm, y=1mm]`, its header says "on paper one unit is 1 mm", and the status
 * bar prints `mm` beside the pointer - so the rulers label themselves `mm` and
 * the numbers they show are the same numbers a dimension on the sheet states.
 * `shared/geometry/drawing-units.js` is the one place that fact is written.
 *
 * At 100% zoom one millimetre is 3.6 pixels, so a 900px canvas spans 250 mm and
 * the ruler labels every 50 mm. The interval adapts to the zoom (100, 50, 20,
 * 10, 5, 2, 1 mm) rather than the numbers being rescaled, so the ruler is
 * readable at every magnification and never lies about the sheet's extent.
 *
 * WHEN THEY REDRAW.
 *
 * One `cameraSignal` subscription plus one `ResizeObserver` on the canvas, and
 * a redraw happens when the camera (zoom, pan, canvas box) or the canvas size
 * actually changed. Every redraw goes through `requestAnimationFrame`-capped
 * coalescing, and the ticks are built in fragments so a pan repaints a few
 * hundred lines rather than rebuilding a tree of elements. When nothing
 * changed, nothing is drawn.
 */

import { DRAWING_UNIT, pixelsPerUnit } from "../../../shared/geometry/drawing-units.js";
import { cameraSignal } from "./canvas-render.js";
import { drawingCanvas } from "../../../features/workspace/dom.js";
import { drawingState } from "../../../features/workspace/editor-state.js";
import { SVG_NAMESPACE } from "../../../features/workspace/constants.js";
import {
  clampLabelCentre,
  clampLabelText,
  formatRulerLabel,
  rulerTicks,
} from "./ruler-scale.js";

/*
 * THE RULERS ARE A SCALE, NOT A READ-OUT.
 *
 * They show the sheet's coordinates - ticks, labelled major divisions, and the
 * numbers to read them by. They deliberately do NOT follow the pointer: there
 * is no line and no value drawn under the cursor. A ruler is a fixed scale
 * beside the drawing, and one that tracked the mouse would be a second, moving
 * read-out beside the canvas's own coordinate display.
 */

/* The one unit DAETUM's internal coordinates are measured in, named. */
export const RULER_UNIT_LABEL = DRAWING_UNIT;

/*
 * How far a tick reaches into the strip, from the seam it shares with the
 * sheet. The strip's depth is `--ruler-depth` in rulers.css, and these depths
 * leave room above a major tick for its label.
 */
const TICK_DEPTH_PX = { major: 9, minor: 4.5 };

/*
 * A CHARACTER'S WIDTH, in ruler pixels, at the label size the stylesheet sets.
 * It is used only to keep a label inside the strip at an edge; the widths are
 * generous, so a label is pulled back a pixel early rather than clipped.
 */
const LABEL_CHARACTER_PX = { x: 2.9, y: 4.2 };

const MAX_LABEL_CHARACTERS = 9;

/*
 * ============================================================
 * THE RULER CHROME
 * ============================================================
 *
 * Built here rather than written into index.html for the same reason the
 * canvas layers are: it is the editor's own aid, it belongs to the canvas
 * element rather than to the page shell, and it exists only when the editor is
 * booting. A page that never opens the Drawing workspace therefore never
 * carries it.
 *
 * Each ruler is one absolutely positioned box holding one SVG whose viewBox is
 * in its own pixels, so the tick list needs no scaling at all: a tick at 123.5
 * is drawn at x=123.5. The box's background is painted by CSS, which is where
 * the theme's neutral surface lives.
 */
function createRulerRoot(axis) {
  const root = document.createElement("div");

  root.className = `drawing-ruler drawing-ruler-${axis}`;
  root.dataset.axis = axis;
  root.setAttribute("aria-hidden", "true");

  /*
   * THE LABELS ARE NOT FOR A SCREEN READER. A ruler spoken aloud is a list
   * of numbers that means nothing without the picture beside it; the canvas
   * itself carries the accessible name, and this is purely a visual aid. It
   * is hidden from assistive technology rather than described twice.
   */

  const svg = document.createElementNS(SVG_NAMESPACE, "svg");

  svg.classList.add("drawing-ruler-scale");
  svg.setAttribute("focusable", "false");
  svg.setAttribute("aria-hidden", "true");

  const parts = {
    root,
    svg,
    ticks: document.createElementNS(SVG_NAMESPACE, "g"),
    labels: document.createElementNS(SVG_NAMESPACE, "g"),
  };

  parts.ticks.classList.add("drawing-ruler-ticks");
  parts.labels.classList.add("drawing-ruler-labels");

  svg.append(parts.ticks, parts.labels);
  root.append(svg);

  return parts;
}

/*
 * THE CORNER BADGE NAMES THE UNIT.
 *
 * It sits in the square between the top ruler and the right ruler - the one
 * place a reader looks to be told what the numbers on both axes mean. It is a
 * plain text box rather than part of either SVG, because it belongs to both.
 */
function createUnitBadge() {
  const badge = document.createElement("div");

  badge.className = "drawing-ruler-unit";
  badge.title = `Ruler: drawing coordinates in ${DRAWING_UNIT} (1 unit = 1 mm)`;
  badge.textContent = DRAWING_UNIT;
  badge.setAttribute("aria-hidden", "true");

  return badge;
}

/* One tick: a line from the inner edge of the ruler to a short or long depth. */
function createTick(line, axis, position, length, major) {
  /*
   * THE WEIGHT IS RECORDED ON THE ELEMENT. The tick list is rebuilt on every
   * pan, and which tick starts the window changes - so a nth-child rule in
   * CSS would darken whichever tick happened to come first. This attribute is
   * the one fact that survives a rebuild, and rulers.css colours by it.
   */
  line.dataset.major = major ? "true" : "false";

  line.setAttribute(axis === "x" ? "x1" : "y1", String(position));
  line.setAttribute(axis === "x" ? "x2" : "y2", String(position));
  line.setAttribute(axis === "x" ? "y1" : "x1", "0");
  line.setAttribute(axis === "x" ? "y2" : "x2", String(length));

  return line;
}

function createLabel(axis, position, text) {
  const label = document.createElementNS(SVG_NAMESPACE, "text");

  label.classList.add("drawing-ruler-label");
  label.textContent = text;

  if (axis === "x") {
    label.setAttribute("x", String(position));
    label.setAttribute("y", "8.5");
    label.setAttribute("text-anchor", "middle");
  } else {
    /*
     * THE RIGHT-HAND RULER TURNS ITS LABELS. Rotating about the label's
     * own point means a number is written down the ruler, which keeps a
     * three-figure label inside a 20px strip: the reading direction
     * matches the direction the ruler measures.
     */
    label.setAttribute("x", String(position));
    label.setAttribute("y", "14");
    label.setAttribute("text-anchor", "middle");
    label.setAttribute("transform", `rotate(90 ${position} 14)`);
  }

  return label;
}

/*
 * ============================================================
 * DRAWING ONE AXIS
 * ============================================================
 */
function paintRuler(parts, size, snapshot) {
  const { svg, ticks: tickGroup, labels: labelGroup } = parts;

  /*
   * The SVG is sized to the ruler EXACTLY - not stretched. A `viewBox` the
   * same size as the box is the identity mapping, so a tick's pixel is a
   * pixel of the strip and a resize cannot rescale the ticks away from the
   * labels.
   */
  svg.setAttribute("viewBox", `0 0 ${size} ${size}`);
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));

  const axis = parts.axis;
  const tickFragment = document.createDocumentFragment();

  if (snapshot.measured) {
    for (const tick of snapshot.ticks) {
      /*
       * THE INNER EDGE IS THE BASELINE, so a tick hangs INTO the ruler
       * from the seam it shares with the sheet. A major tick reaches
       * further than a minor one - the hierarchy is what makes an
       * interval readable at a glance.
       */
      const depth = tick.major ? TICK_DEPTH_PX.major : TICK_DEPTH_PX.minor;

      tickFragment.appendChild(
        createTick(
          document.createElementNS(SVG_NAMESPACE, "line"),
          axis,
          tick.position,
          depth,
          tick.major,
        ),
      );
    }
  }

  tickGroup.replaceChildren(tickFragment);

  const labelFragment = document.createDocumentFragment();

  for (const entry of snapshot.measured ? snapshot.labels : []) {
    const text = clampLabelText(
      formatRulerLabel(entry.value),
      MAX_LABEL_CHARACTERS,
    );

    /*
     * A label near an edge is pulled back inside the strip by its own
     * width, so "120" at the far right is not half cut off by the canvas.
     */
    const halfWidth = text.length * LABEL_CHARACTER_PX[axis];

    labelFragment.appendChild(
      createLabel(
        axis,
        clampLabelCentre(entry.position, halfWidth, size),
        text,
      ),
    );
  }

  labelGroup.replaceChildren(labelFragment);
}

/*
 * ============================================================
 * THE INSTALLER
 * ============================================================
 */
export function installDrawingRulers() {
  if (!globalThis.document || !drawingCanvas) {
    return () => {};
  }

  if (drawingCanvas.__drawingRulers) {
    return drawingCanvas.__drawingRulers.uninstall;
  }

  const top = createRulerRoot("x");
  const right = createRulerRoot("y");
  const badge = createUnitBadge();

  drawingCanvas.append(top.root, right.root, badge);

  /*
   * The last snapshot, so an unchanged camera does not repaint and a
   * ResizeObserver firing for an unrelated reason costs nothing.
   */
  let lastKey = null;
  let frame = 0;
  let disposed = false;

  /* What the canvas currently reports, in CSS pixels. */
  const canvasSize = () => {
    const width = drawingCanvas.clientWidth;
    const height = drawingCanvas.clientHeight;

    if (width > 0 && height > 0) {
      return { width, height };
    }

    const rect = drawingCanvas.getBoundingClientRect?.();

    return {
      width: Math.max(0, rect?.width || 0),
      height: Math.max(0, rect?.height || 0),
    };
  };

  const draw = () => {
    frame = 0;

    if (disposed) {
      return;
    }

    const { width, height } = canvasSize();

    if (width <= 0 || height <= 0) {
      top.root.hidden = true;
      right.root.hidden = true;
      badge.hidden = true;

      return;
    }

    top.root.hidden = false;
    right.root.hidden = false;
    badge.hidden = false;

    const zoom = Math.max(Number(drawingState?.camera?.zoom) || 1, 1e-6);

    const pixelsPerMm = pixelsPerUnit(zoom);

    const panX = Number(drawingState?.camera?.panX) || 0;
    const panY = Number(drawingState?.camera?.panY) || 0;
    const snapSpacing = Number(drawingState?.grid?.spacing);

    const key = [width, height, zoom, panX, panY, snapSpacing].join("|");

    /*
     * NOTHING CHANGED, NOTHING DRAWN. The rulers read only the camera and
     * the canvas box, never the pointer, so those are the whole story.
     */
    if (key === lastKey) {
      return;
    }

    lastKey = key;

    const topSnapshot = rulerTicks({
      axis: "x",
      size: width,
      pan: panX,
      pixelsPerUnit: pixelsPerMm,
      snapSpacing,
    });

    const rightSnapshot = rulerTicks({
      axis: "y",
      size: height,
      pan: panY,
      pixelsPerUnit: pixelsPerMm,
      snapSpacing,
    });

    paintRuler(top, width, topSnapshot);
    paintRuler(right, height, rightSnapshot);
  };

  const schedule = () => {
    if (disposed || frame) {
      return;
    }

    if (typeof globalThis.requestAnimationFrame === "function") {
      frame = globalThis.requestAnimationFrame(draw);
    } else {
      draw();
    }
  };

  const unsubscribeCamera = cameraSignal(schedule);

  let observer = null;

  if (typeof globalThis.ResizeObserver === "function") {
    observer = new globalThis.ResizeObserver(schedule);
    observer.observe(drawingCanvas);
  }

  globalThis.addEventListener?.("resize", schedule, { passive: true });

  /* The first paint, so the rulers are there before the first gesture. */
  schedule();

  const uninstall = () => {
    if (disposed) {
      return;
    }

    disposed = true;

    if (frame && typeof globalThis.cancelAnimationFrame === "function") {
      globalThis.cancelAnimationFrame(frame);
    }

    frame = 0;

    unsubscribeCamera();

    observer?.disconnect();

    globalThis.removeEventListener?.("resize", schedule);

    top.root.remove();
    right.root.remove();
    badge.remove();

    delete drawingCanvas.__drawingRulers;
  };

  drawingCanvas.__drawingRulers = { redraw: schedule, uninstall };

  return uninstall;
}

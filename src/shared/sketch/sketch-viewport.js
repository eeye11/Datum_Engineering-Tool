/*
 * ============================================================
 * THE SHARED SKETCH VIEWPORT
 * ============================================================
 *
 * The one place where sketch MODEL coordinates and SCREEN pixels meet.
 *
 * WHY THIS IS ITS OWN MODULE
 * --------------------------
 * "Zoom must not change stored coordinates" is easy to say and easy to break:
 * one handler that writes a pixel value into a point, one fit that scales a
 * stored radius, and the drawing is quietly wrong at every zoom but the one it
 * was made at. So the conversion lives here, in two pure functions, and every
 * editor, adapter and test uses them. Nothing else in the sketch system is
 * allowed to do this arithmetic.
 *
 *     toScreen(point, viewport)   model -> pixels
 *     toModel(pixel, viewport)    pixels -> model   (the exact inverse)
 *
 * EQUAL X/Y SCALE
 * ---------------
 * A circle must stay a circle and an angle must keep its size, so by default
 * one model unit is the SAME number of pixels on both axes. The viewport is
 * fitted to the bounds with a single scale - the smaller of the two that would
 * fill the box - and the leftover space is centred. That is what makes the
 * drawing undistorted at any canvas shape.
 *
 * When equal scale is switched off, each axis fills its own extent. That is a
 * deliberate choice a student can make (a stretched view of a function, say),
 * and it is stated in the viewport rather than implied by the canvas shape.
 *
 * THE VIEWPORT IS DERIVED, NEVER STORED
 * -------------------------------------
 * A viewport is computed from (bounds, canvas size, equal-scale flag) every
 * time it is needed. It is not part of the document, so resizing the window
 * cannot change the geometry - there is nothing in the geometry to change.
 */

const EPSILON = 1e-9;

function finite(value, fallback = 0) {
  const number = Number(value);

  return Number.isFinite(number) ? number : fallback;
}

/* A usable bounds object, whatever was passed in. */
export function normaliseBounds(
  bounds,
  fallback = { xMin: -5, xMax: 5, yMin: -5, yMax: 5 },
) {
  const source = bounds || fallback;

  let xMin = finite(source.xMin, fallback.xMin);
  let xMax = finite(source.xMax, fallback.xMax);
  let yMin = finite(source.yMin, fallback.yMin);
  let yMax = finite(source.yMax, fallback.yMax);

  /* A crossed or collapsed range is not a range; widen it to something usable. */
  if (!(xMax - xMin > EPSILON)) {
    const centre = (xMin + xMax) / 2;
    xMin = centre - 1;
    xMax = centre + 1;
  }

  if (!(yMax - yMin > EPSILON)) {
    const centre = (yMin + yMax) / 2;
    yMin = centre - 1;
    yMax = centre + 1;
  }

  return { xMin, xMax, yMin, yMax };
}

/*
 * Build the viewport for a canvas.
 *
 *   bounds   the model range the canvas shows
 *   width    the canvas's pixel width
 *   height   the canvas's pixel height
 *   equal    one model unit is the same number of pixels on both axes
 *   padding  pixels kept clear at the edges, so ink is not flush to the border
 *
 * The result carries the scale, the offset and the model rectangle actually
 * visible - which is the bounds when equal scale is off, and a WIDER range on
 * one axis when it is on (the axis that had room to spare).
 */
export function createViewport({
  bounds = null,
  width = 0,
  height = 0,
  equal = true,
  padding = 0,
} = {}) {
  const range = normaliseBounds(bounds);

  const boxWidth = Math.max(finite(width) - 2 * finite(padding), 1);
  const boxHeight = Math.max(finite(height) - 2 * finite(padding), 1);

  const spanX = range.xMax - range.xMin;
  const spanY = range.yMax - range.yMin;

  const scaleX = boxWidth / spanX;
  const scaleY = boxHeight / spanY;

  const scale = equal ? Math.min(scaleX, scaleY) : null;

  const usedWidth = equal ? spanX * scale : boxWidth;
  const usedHeight = equal ? spanY * scale : boxHeight;

  /* Centre the used area in the box, then add the padding back. */
  const offsetX = finite(padding) + (boxWidth - usedWidth) / 2;
  const offsetY = finite(padding) + (boxHeight - usedHeight) / 2;

  /*
   * THE VISIBLE MODEL RECTANGLE. With equal scale the spare room on the wider
   * axis shows MORE of the model, so the visible range is wider than the
   * requested bounds on that axis - and that is what the axes and grid must be
   * drawn against, not the requested bounds.
   */
  const visible = equal
    ? {
        xMin: range.xMin - offsetX / scale,
        xMax: range.xMin + (finite(width) - offsetX) / scale,
        yMax: range.yMax + offsetY / scale,
        yMin: range.yMax - (finite(height) - offsetY) / scale,
      }
    : { ...range };

  return {
    width: finite(width),
    height: finite(height),
    padding: finite(padding),
    equal: Boolean(equal),
    bounds: range,
    visible,
    scaleX: equal ? scale : scaleX,
    scaleY: equal ? scale : scaleY,
    scale: equal ? scale : Math.min(scaleX, scaleY),
    offsetX,
    offsetY,
    usedWidth,
    usedHeight,
  };
}

/* Model point -> canvas pixel. */
/*
 * MODEL -> PIXEL, FROM THE BOUNDS AND THE OFFSET.
 *
 * The mapping is built from `bounds` and `offset`, NOT from `visible`. With
 * equal scale the visible range is WIDER than the requested bounds (the spare
 * room on the short axis shows more of the model), so mapping from `visible`
 * while offsetting for the unused margin counts that margin twice - and the
 * origin drifts off-centre at every aspect ratio that is not exactly the
 * bounds'. Bounds plus offset is the one statement that is true for both modes.
 */
export function toScreen(point, viewport) {
  if (!viewport) {
    return { x: 0, y: 0 };
  }

  const { bounds, scaleX, scaleY, offsetX, offsetY } = viewport;

  return {
    x: offsetX + (finite(point?.x) - bounds.xMin) * scaleX,
    y: offsetY + (bounds.yMax - finite(point?.y)) * scaleY,
  };
}

/* Canvas pixel -> model point. The exact inverse of `toScreen`. */
export function toModel(pixel, viewport) {
  if (!viewport) {
    return { x: 0, y: 0 };
  }

  const { bounds, scaleX, scaleY, offsetX, offsetY } = viewport;

  return {
    x: bounds.xMin + (finite(pixel?.x) - offsetX) / scaleX,
    y: bounds.yMax - (finite(pixel?.y) - offsetY) / scaleY,
  };
}

/* A model LENGTH in pixels, along the axis that is densest. */
export function modelLengthToPixels(length, viewport) {
  if (!viewport) {
    return finite(length);
  }

  return finite(length) * Math.max(viewport.scaleX, viewport.scaleY);
}

/* A pixel LENGTH in model units, along the axis that is densest. */
export function pixelsToModelLength(pixels, viewport) {
  if (!viewport) {
    return finite(pixels);
  }

  return finite(pixels) / Math.max(viewport.scaleX, viewport.scaleY);
}

/* ============================================================
 * BOUNDS FROM GEOMETRY
 * ============================================================ */

/*
 * The range that contains every point, with a margin.
 *
 * The margin is a SHARE of the extent rather than a fixed distance, so a small
 * sketch and a large one both get room to breathe, and a degenerate sketch (one
 * point, or a perfectly horizontal line) still gets a usable box instead of a
 * zero-height range.
 */
export function boundsOfPoints(
  points = [],
  { margin = 0.08, minimumSpan = 1 } = {},
) {
  const list = (Array.isArray(points) ? points : []).filter(
    (point) =>
      point &&
      Number.isFinite(Number(point.x)) &&
      Number.isFinite(Number(point.y)),
  );

  if (!list.length) {
    return { xMin: -5, xMax: 5, yMin: -5, yMax: 5 };
  }

  const xs = list.map((point) => Number(point.x));
  const ys = list.map((point) => Number(point.y));

  let xMin = Math.min(...xs);
  let xMax = Math.max(...xs);
  let yMin = Math.min(...ys);
  let yMax = Math.max(...ys);

  const spanX = Math.max(xMax - xMin, minimumSpan);
  const spanY = Math.max(yMax - yMin, minimumSpan);

  /* Centre a degenerate axis on its own value rather than on zero. */
  if (xMax - xMin < minimumSpan) {
    const centre = (xMin + xMax) / 2;
    xMin = centre - spanX / 2;
    xMax = centre + spanX / 2;
  }

  if (yMax - yMin < minimumSpan) {
    const centre = (yMin + yMax) / 2;
    yMin = centre - spanY / 2;
    yMax = centre + spanY / 2;
  }

  const padX = (xMax - xMin) * margin;
  const padY = (yMax - yMin) * margin;

  return {
    xMin: xMin - padX,
    xMax: xMax + padX,
    yMin: yMin - padY,
    yMax: yMax + padY,
  };
}

/*
 * Widen a range so the origin is inside it.
 *
 * The axes are drawn through zero, so a range that excludes zero would take
 * them off the sheet. Widening to include (0, 0) keeps them visible however far
 * into a corner the drawing goes.
 */
export function withOriginInView(bounds) {
  const range = normaliseBounds(bounds);

  return {
    xMin: Math.min(range.xMin, 0),
    xMax: Math.max(range.xMax, 0),
    yMin: Math.min(range.yMin, 0),
    yMax: Math.max(range.yMax, 0),
  };
}

/* Whether a model point is inside the visible rectangle. */
export function isVisible(point, viewport) {
  if (!viewport) {
    return false;
  }

  const { visible } = viewport;

  return (
    finite(point?.x) >= visible.xMin &&
    finite(point?.x) <= visible.xMax &&
    finite(point?.y) >= visible.yMin &&
    finite(point?.y) <= visible.yMax
  );
}

export default {
  normaliseBounds,
  createViewport,
  toScreen,
  toModel,
  modelLengthToPixels,
  pixelsToModelLength,
  boundsOfPoints,
  withOriginInView,
  isVisible,
};

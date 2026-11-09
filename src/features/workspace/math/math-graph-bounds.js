/*
 * ============================================================
 * THE GRAPH'S COORDINATE BOUNDS
 * ============================================================
 *
 * The rectangle of the mathematical plane the graph shows: xMin..xMax and
 * yMin..yMax. In the editor these four numbers ARE the canvas - xMin is its left
 * edge, xMax its right, yMin its bottom, yMax its top - so they are the one place
 * the coordinate space is defined.
 *
 * TWO MODES, AND ONE OF THEM IS THE DEFAULT
 * -----------------------------------------
 *
 *   automatic  the bounds are calculated from what the student DEFINED: their
 *              points, the endpoints of their lines, the endpoints and anchors
 *              of their curves. Add a point at (4, 5) and the range grows to
 *              contain it; delete it and the range settles back. The result is
 *              padded and rounded to readable numbers, so the axes fall on 0,
 *              ±1, ±10 rather than on 3.7142857.
 *
 *   manual     the student typed the four numbers. Nothing is recalculated, ever
 *              - not when a stroke is drawn, not when a point moves. Typing a
 *              bound is what switches the editor to this mode.
 *
 * WHAT IS DELIBERATELY NOT AN INPUT
 * ---------------------------------
 * A stroke's SAMPLES are not geometry - they are how a freehand line was
 * recorded - and neither are the interpolation points behind a fitted curve. If
 * they were inputs, the bounds would jitter on every sample and a curve's fine
 * fluff would set the scale of the whole graph. So only the things a student
 * could point at are read: explicit points and the two endpoints of each
 * stroke.
 *
 * AND THERE IS ALWAYS A RANGE. One point, two points on top of each other, a
 * perfectly horizontal line: each of these would give a zero-height or
 * zero-width range, which cannot be mapped. Every case is widened to a minimum
 * span, so the mapping is always invertible.
 */

/* The range used when there is nothing at all to contain. */
export const DEFAULT_GRAPH_BOUNDS = Object.freeze({
  xMin: -5,
  xMax: 5,
  yMin: -5,
  yMax: 5,
});

/* The smallest span either axis is allowed, in graph units. */
export const MIN_BOUNDS_SPAN = 1;

/* The padding around the outermost geometry, as a share of its extent. */
export const BOUNDS_PADDING_SHARE = 0.12;

/* How many "nice" steps the rounded bounds are chosen from. */
const NICE_STEPS = [1, 2, 2.5, 5, 10];

/* A finite number, or null. */
function finiteOrNull(value) {
  const number = Number(value);

  return Number.isFinite(number) ? number : null;
}

/*
 * A NICE STEP AT OR ABOVE `value`.
 *
 * The bounds are rounded to a multiple of one of these, which is what makes a
 * range read as -3..5 rather than -3.087..5.219. The list is short on purpose:
 * 2.5 is included because a span of five units padded by a fifth wants a step
 * somewhere between two and five, and 2.5 is the readable one.
 */
export function niceStepAtLeast(value) {
  const magnitude = Math.max(Number(value) || 0, 1e-9);

  const exponent = Math.floor(Math.log10(magnitude));

  const base = 10 ** exponent;

  for (const step of NICE_STEPS) {
    if (step * base >= magnitude - 1e-12) {
      return step * base;
    }
  }

  return 10 * base;
}

function roundDown(value, step) {
  return Math.floor(value / step + 1e-9) * step;
}

function roundUp(value, step) {
  return Math.ceil(value / step - 1e-9) * step;
}

/* A number without floating-point dust, for display and storage. */
function tidy(value) {
  return Number(Number(value).toFixed(10));
}

/* A span that cannot be zero, widened symmetrically about its centre. */
function usableSpan(min, max) {
  const low = Math.min(min, max);
  const high = Math.max(min, max);

  if (high - low >= MIN_BOUNDS_SPAN) {
    return { min: low, max: high };
  }

  /* Centred on the pair, so one point and two identical points agree. */
  const centre = (low + high) / 2;
  const half = MIN_BOUNDS_SPAN / 2;

  return { min: centre - half, max: centre + half };
}

/*
 * THE COORDINATES THAT DEFINE THE GRAPH'S EXTENT.
 *
 * `points` are the student's explicit points; each stroke contributes its two
 * ENDS, not its samples. Both are what a student could point at, which is the
 * test for "is this geometry or is it an implementation detail".
 */
export function extentPoints({ points = [], strokes = [] } = {}) {
  const list = [];

  (Array.isArray(points) ? points : []).forEach((point) => {
    const x = finiteOrNull(point?.x);
    const y = finiteOrNull(point?.y);

    if (x !== null && y !== null) {
      list.push({ x, y });
    }
  });

  (Array.isArray(strokes) ? strokes : []).forEach((stroke) => {
    const source = Array.isArray(stroke?.points) && stroke.points.length
      ? stroke.points
      : Array.isArray(stroke)
        ? stroke
        : [];

    if (!source.length) {
      return;
    }

    [source[0], source[source.length - 1]].forEach((point) => {
      const x = finiteOrNull(point?.x);
      const y = finiteOrNull(point?.y);

      if (x !== null && y !== null) {
        list.push({ x, y });
      }
    });
  });

  return list;
}

/*
 * AUTOMATIC BOUNDS.
 *
 * From the extent points, padded by a share of their own span, then rounded out
 * to a readable step - and widened to a usable minimum where the geometry is
 * degenerate. An empty graph keeps the familiar -5..5.
 */
export function automaticBounds(input = {}) {
  const list = extentPoints(input);

  if (!list.length) {
    return { ...DEFAULT_GRAPH_BOUNDS };
  }

  const xs = list.map((point) => point.x);
  const ys = list.map((point) => point.y);

  const rawX = usableSpan(Math.min(...xs), Math.max(...xs));
  const rawY = usableSpan(Math.min(...ys), Math.max(...ys));

  const spanX = rawX.max - rawX.min;
  const spanY = rawY.max - rawY.min;

  const padX = spanX * BOUNDS_PADDING_SHARE;
  const padY = spanY * BOUNDS_PADDING_SHARE;

  const stepX = niceStepAtLeast((spanX + 2 * padX) / 8);
  const stepY = niceStepAtLeast((spanY + 2 * padY) / 8);

  const padded = {
    xMin: roundDown(rawX.min - padX, stepX),
    xMax: roundUp(rawX.max + padX, stepX),
    yMin: roundDown(rawY.min - padY, stepY),
    yMax: roundUp(rawY.max + padY, stepY),
  };

  /* The rounding must not collapse a range; the minimum span is the floor. */
  const x = usableSpan(padded.xMin, padded.xMax);
  const y = usableSpan(padded.yMin, padded.yMax);

  return {
    xMin: tidy(x.min),
    xMax: tidy(x.max),
    yMin: tidy(y.min),
    yMax: tidy(y.max),
  };
}

/* Whether a bounds object is four usable numbers. */
export function validBounds(bounds) {
  if (!bounds) {
    return false;
  }

  return ["xMin", "xMax", "yMin", "yMax"].every(
    (key) => finiteOrNull(bounds[key]) !== null,
  );
}

/*
 * THE BOUNDS IN EFFECT.
 *
 * `mode` is the authority: an invalid manual entry does not silently fall back
 * to a guess, because a half-typed range would then move the graph under the
 * student's hands. It falls back to the bounds ALREADY IN EFFECT, which is the
 * last thing that was valid.
 */
export function resolveBounds({ mode = "auto", bounds = null, fallback = null, geometry = {} } = {}) {
  if (mode === "manual" && validBounds(bounds)) {
    const x = usableSpan(finiteOrNull(bounds.xMin), finiteOrNull(bounds.xMax));
    const y = usableSpan(finiteOrNull(bounds.yMin), finiteOrNull(bounds.yMax));

    return {
      xMin: tidy(x.min),
      xMax: tidy(x.max),
      yMin: tidy(y.min),
      yMax: tidy(y.max),
    };
  }

  if (mode === "manual" && validBounds(fallback)) {
    return { ...fallback };
  }

  return automaticBounds(geometry);
}

/* Whether a point lies inside the bounds. */
export function insideBounds(bounds, point) {
  if (!validBounds(bounds) || !point) {
    return true;
  }

  return (
    Number(point.x) >= bounds.xMin - 1e-9 &&
    Number(point.x) <= bounds.xMax + 1e-9 &&
    Number(point.y) >= bounds.yMin - 1e-9 &&
    Number(point.y) <= bounds.yMax + 1e-9
  );
}

/* The shapes that fall, wholly or partly, outside the bounds. */
export function outsideBounds(bounds, { points = [], strokes = [] } = {}) {
  const outside = [];

  (Array.isArray(points) ? points : []).forEach((point) => {
    if (!insideBounds(bounds, point)) {
      outside.push({ kind: "point", id: point.id || null, at: { ...point } });
    }
  });

  (Array.isArray(strokes) ? strokes : []).forEach((stroke) => {
    const source = Array.isArray(stroke?.points) ? stroke.points : [];

    const beyond = source.filter((point) => !insideBounds(bounds, point));

    if (beyond.length) {
      outside.push({
        kind: "stroke",
        id: stroke.id || null,
        count: beyond.length,
        at: { ...beyond[0] },
      });
    }
  });

  return outside;
}

/*
 * THE GEOMETRY A GRAPH STORES, AS THIS MODULE'S INPUT.
 *
 * A saved graph carries `points` and a list of function components. A sketched
 * component's path is written out in full, so its TWO ENDS are its endpoints -
 * the same rule as a live stroke.
 */
export function geometryInput(geometry) {
  const functions = Array.isArray(geometry?.functions) ? geometry.functions : [];

  const strokes = functions
    .filter((component) => component?.mode === "sketch" || Array.isArray(component?.points))
    .map((component) => ({ points: Array.isArray(component.points) ? component.points : [] }));

  return {
    points: Array.isArray(geometry?.points) ? geometry.points : [],
    strokes,
  };
}

const enggMathGraphBounds = {
  DEFAULT_GRAPH_BOUNDS,
  MIN_BOUNDS_SPAN,
  BOUNDS_PADDING_SHARE,
  niceStepAtLeast,
  extentPoints,
  automaticBounds,
  validBounds,
  resolveBounds,
  insideBounds,
  outsideBounds,
  geometryInput,
};

export default enggMathGraphBounds;

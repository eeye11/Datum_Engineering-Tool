/*
 * ============================================================
 * GEOMETRY ADAPTERS
 * ============================================================
 *
 * One interface, several geometries. A line, a circle, an arc, an ellipse, a
 * rectangle, a polygon and a free curve are NOT the same mathematics, and
 * pretending otherwise would produce a fitter that is wrong for all of them.
 * What they DO share is the way the rest of the system talks to them:
 *
 *     project(point)        the nearest point ON the geometry, with its parameter
 *     pointAt(t)            the point at a parameter
 *     length()              the geometry's own length
 *     sample(count)         points along it, for drawing and for fitting
 *     withPointAt(t, p)     the geometry with a point inserted at t
 *     constraints()         what this geometry needs to be determined
 *
 * That is the whole contract. The shared point model, the shared viewport, the
 * shared selection and the shared undo do not know or care which adapter they
 * are holding - which is what makes "an anchor means the same thing in every
 * tool" true rather than aspirational.
 *
 * WHAT IS DELIBERATELY NOT SHARED
 * -------------------------------
 * The FITTING. A circle is fitted by a least-squares circle, an ellipse by an
 * axis-aligned conic, a line by total least squares. Forcing one solver on all
 * of them is how a rough circle becomes a wobbly spline. The adapters share the
 * INTERFACE and the CONSTRAINT SEMANTICS; each keeps its own mathematics.
 *
 * PARAMETERS
 * ----------
 * `t` is the adapter's own: 0..1 along a line, a curve or a polygon's perimeter;
 * an angle in radians for a circle or an arc. Nothing outside the adapter
 * interprets it, so a circle's parameter can be an angle without the rest of
 * the system having to know that.
 */

import { makePoint } from "./sketch-points.js";

const EPSILON = 1e-9;

function finite(value, fallback = 0) {
  const number = Number(value);

  return Number.isFinite(number) ? number : fallback;
}

function distance(a, b) {
  return Math.hypot(finite(a?.x) - finite(b?.x), finite(a?.y) - finite(b?.y));
}

function lerp(a, b, t) {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  };
}

/* The parameter of the closest point on a segment, clamped to it. */
function segmentParameter(point, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;

  if (lengthSquared < EPSILON) {
    return 0;
  }

  const t = ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared;

  return Math.max(0, Math.min(1, t));
}

/* ============================================================
 * LINE
 * ============================================================ */
export function lineAdapter({ id = "line", start, end, points, closed = false } = {}) {
  /*
   * A LINE MAY BE DESCRIBED EITHER WAY - `start`/`end` or `points`.
   *
   * The document stores endpoints as `points`, and the recogniser produces
   * them that way; a caller may also name them. Reading only the named fields
   * made every stored line zero-length, which is exactly the kind of silent
   * mismatch one interface is meant to prevent.
   */
  const from = start || points?.[0] || { x: 0, y: 0 };
  const to = end || points?.[points.length - 1] || from;

  const a = { x: finite(from?.x), y: finite(from?.y) };
  const b = { x: finite(to?.x), y: finite(to?.y) };

  return {
    id,
    kind: "line",
    closed: Boolean(closed),
    start: a,
    end: b,
    pointAt: (t) => lerp(a, b, Math.max(0, Math.min(1, finite(t)))),
    project: (point) => {
      const t = segmentParameter(point, a, b);
      const at = lerp(a, b, t);

      return { ...at, t, distance: distance(point, at) };
    },
    length: () => distance(a, b),
    sample: (count = 2) => {
      const steps = Math.max(2, Math.floor(count));

      return Array.from({ length: steps }, (_, index) =>
        lerp(a, b, index / (steps - 1)),
      );
    },
    withPointAt: (t, point) => {
      const at = lerp(a, b, Math.max(0, Math.min(1, finite(t))));

      return {
        ...lineAdapter({ id, start: a, end: at }),
        /* The inserted point is the new end of the first piece. */
        inserted: { x: finite(point?.x, at.x), y: finite(point?.y, at.y) },
      };
    },
    constraints: () => ({ determined: true, needs: [] }),
  };
}

/* ============================================================
 * POLYLINE / POLYGON
 * ============================================================ */
export function polylineAdapter({
  id = "polyline",
  points = [],
  closed = false,
} = {}) {
  const vertices = (Array.isArray(points) ? points : []).map((point) => ({
    x: finite(point?.x),
    y: finite(point?.y),
  }));

  const segments = () => {
    const list = [];

    for (let index = 0; index < vertices.length - 1; index += 1) {
      list.push([vertices[index], vertices[index + 1]]);
    }

    if (closed && vertices.length > 2) {
      list.push([vertices[vertices.length - 1], vertices[0]]);
    }

    return list;
  };

  const lengths = () => segments().map(([a, b]) => distance(a, b));

  const total = () => lengths().reduce((sum, value) => sum + value, 0);

  return {
    id,
    kind: closed ? "polygon" : "polyline",
    closed: Boolean(closed),
    points: vertices,
    pointAt: (t) => {
      const list = segments();

      if (!list.length) {
        return { x: 0, y: 0 };
      }

      const span = total();

      if (span < EPSILON) {
        return { ...list[0][0] };
      }

      let remaining = Math.max(0, Math.min(1, finite(t))) * span;

      for (const [a, b] of list) {
        const length = distance(a, b);

        if (remaining <= length || length < EPSILON) {
          return lerp(a, b, length < EPSILON ? 0 : remaining / length);
        }

        remaining -= length;
      }

      return { ...list[list.length - 1][1] };
    },
    project: (point) => {
      const list = segments();

      let best = { x: 0, y: 0, t: 0, distance: Infinity };

      const span = total();

      let travelled = 0;

      list.forEach(([a, b]) => {
        const local = segmentParameter(point, a, b);
        const at = lerp(a, b, local);
        const away = distance(point, at);

        if (away < best.distance) {
          const length = distance(a, b);

          best = {
            ...at,
            t: span < EPSILON ? 0 : (travelled + local * length) / span,
            distance: away,
          };
        }

        travelled += distance(a, b);
      });

      return best;
    },
    length: total,
    sample: (count = 24) => {
      const steps = Math.max(2, Math.floor(count));

      return Array.from({ length: steps }, (_, index) => {
        const t = index / (steps - 1);

        return {
          x: 0,
          y: 0,
          ...(() => {
            const list = segments();
            const span = total();

            if (!list.length || span < EPSILON) {
              return list[0]?.[0] || { x: 0, y: 0 };
            }

            let remaining = t * span;

            for (const [a, b] of list) {
              const length = distance(a, b);

              if (remaining <= length || length < EPSILON) {
                return lerp(a, b, length < EPSILON ? 0 : remaining / length);
              }

              remaining -= length;
            }

            return list[list.length - 1][1];
          })(),
        };
      });
    },
    withPointAt: (t, point) => {
      const at = { x: finite(point?.x), y: finite(point?.y) };

      /* Insert at the vertex nearest the parameter, keeping the order. */
      const list = segments();
      const span = total();

      let remaining = Math.max(0, Math.min(1, finite(t))) * span;
      let index = 0;

      for (let cursor = 0; cursor < list.length; cursor += 1) {
        const length = distance(list[cursor][0], list[cursor][1]);

        if (remaining <= length) {
          index = cursor;
          break;
        }

        remaining -= length;
        index = cursor + 1;
      }

      const next = [...vertices];
      next.splice(Math.min(index + 1, next.length), 0, at);

      return polylineAdapter({ id, points: next, closed });
    },
    constraints: () => ({
      determined: vertices.length >= 2,
      needs: vertices.length >= 2 ? [] : ["at least two vertices"],
    }),
  };
}

/* ============================================================
 * CIRCLE
 * ============================================================ */
export function circleAdapter({ id = "circle", centre, radius = 1 } = {}) {
  const c = { x: finite(centre?.x), y: finite(centre?.y) };
  const r = Math.max(EPSILON, Math.abs(finite(radius, 1)));

  return {
    id,
    kind: "circle",
    closed: true,
    centre: c,
    radius: r,
    pointAt: (t) => ({
      x: c.x + r * Math.cos(finite(t)),
      y: c.y + r * Math.sin(finite(t)),
    }),
    project: (point) => {
      const dx = finite(point?.x) - c.x;
      const dy = finite(point?.y) - c.y;
      const angle = Math.atan2(dy, dx);

      return {
        x: c.x + r * Math.cos(angle),
        y: c.y + r * Math.sin(angle),
        t: angle,
        distance: Math.abs(Math.hypot(dx, dy) - r),
      };
    },
    length: () => 2 * Math.PI * r,
    sample: (count = 64) => {
      const steps = Math.max(8, Math.floor(count));

      return Array.from({ length: steps + 1 }, (_, index) => {
        const angle = (index / steps) * Math.PI * 2;

        return { x: c.x + r * Math.cos(angle), y: c.y + r * Math.sin(angle) };
      });
    },
    withPointAt: (t, point) => {
      const angle = finite(t);
      const at = { x: finite(point?.x), y: finite(point?.y) };

      return {
        ...circleAdapter({ id, centre: c, radius: r }),
        inserted: at,
        insertedAngle: angle,
      };
    },
    constraints: () => ({
      determined: true,
      needs: [],
      note: "A circle is determined by its centre and radius.",
    }),
  };
}

/* ============================================================
 * ARC
 * ============================================================ */
export function arcAdapter({
  id = "arc",
  centre,
  radius = 1,
  startAngle = 0,
  endAngle = Math.PI,
  clockwise = false,
} = {}) {
  const c = { x: finite(centre?.x), y: finite(centre?.y) };
  const r = Math.max(EPSILON, Math.abs(finite(radius, 1)));

  let from = finite(startAngle);
  let to = finite(endAngle);

  /* Normalise the sweep to the direction asked for. */
  if (clockwise) {
    while (to > from) to -= Math.PI * 2;
  } else {
    while (to < from) to += Math.PI * 2;
  }

  const sweep = to - from;

  return {
    id,
    kind: "arc",
    closed: false,
    centre: c,
    radius: r,
    startAngle: from,
    endAngle: to,
    clockwise: Boolean(clockwise),
    pointAt: (t) => {
      const angle = from + sweep * Math.max(0, Math.min(1, finite(t)));

      return { x: c.x + r * Math.cos(angle), y: c.y + r * Math.sin(angle) };
    },
    project: (point) => {
      const dx = finite(point?.x) - c.x;
      const dy = finite(point?.y) - c.y;
      const angle = Math.atan2(dy, dx);

      let offset = angle - from;

      if (clockwise) {
        while (offset > 0) offset -= Math.PI * 2;
        while (offset < sweep) offset += Math.PI * 2;
      } else {
        while (offset < 0) offset += Math.PI * 2;
        while (offset > sweep) offset -= Math.PI * 2;
      }

      const t = Math.abs(sweep) < EPSILON ? 0 : offset / sweep;
      const clamped = Math.max(0, Math.min(1, t));
      const at = {
        x: c.x + r * Math.cos(from + sweep * clamped),
        y: c.y + r * Math.sin(from + sweep * clamped),
      };

      return { ...at, t: clamped, distance: distance(point, at) };
    },
    length: () => Math.abs(sweep) * r,
    sample: (count = 32) => {
      const steps = Math.max(2, Math.floor(count));

      return Array.from({ length: steps }, (_, index) => {
        const angle = from + sweep * (index / (steps - 1));

        return { x: c.x + r * Math.cos(angle), y: c.y + r * Math.sin(angle) };
      });
    },
    withPointAt: (t, point) => {
      const angle = from + sweep * Math.max(0, Math.min(1, finite(t)));

      return {
        ...arcAdapter({
          id,
          centre: c,
          radius: r,
          startAngle: from,
          endAngle: angle,
          clockwise,
        }),
        inserted: { x: finite(point?.x), y: finite(point?.y) },
        insertedAngle: angle,
      };
    },
    constraints: () => ({
      determined: true,
      needs: [],
      note: "An arc is determined by its centre, radius and two angles.",
    }),
  };
}

/* ============================================================
 * ELLIPSE
 * ============================================================ */
export function ellipseAdapter({
  id = "ellipse",
  centre,
  radiusX = 1,
  radiusY = 1,
  rotation = 0,
} = {}) {
  const c = { x: finite(centre?.x), y: finite(centre?.y) };
  const rx = Math.max(EPSILON, Math.abs(finite(radiusX, 1)));
  const ry = Math.max(EPSILON, Math.abs(finite(radiusY, 1)));
  const phi = finite(rotation);

  const cos = Math.cos(phi);
  const sin = Math.sin(phi);

  const toWorld = (u, v) => ({
    x: c.x + u * cos - v * sin,
    y: c.y + u * sin + v * cos,
  });

  return {
    id,
    kind: "ellipse",
    closed: true,
    centre: c,
    radiusX: rx,
    radiusY: ry,
    rotation: phi,
    pointAt: (t) => {
      const angle = finite(t);

      return toWorld(rx * Math.cos(angle), ry * Math.sin(angle));
    },
    project: (point) => {
      /*
       * The nearest point on an ellipse has no closed form, so the parameter is
       * found by a coarse sweep refined by a few bisections. It is exact enough
       * for a click to land on the curve, and it is the same answer every time.
       */
      const dx = finite(point?.x) - c.x;
      const dy = finite(point?.y) - c.y;

      const local = {
        x: dx * cos + dy * sin,
        y: -dx * sin + dy * cos,
      };

      let best = { angle: 0, distance: Infinity };

      const steps = 72;

      for (let index = 0; index < steps; index += 1) {
        const angle = (index / steps) * Math.PI * 2;
        const at = { x: rx * Math.cos(angle), y: ry * Math.sin(angle) };
        const away = Math.hypot(at.x - local.x, at.y - local.y);

        if (away < best.distance) {
          best = { angle, distance: away };
        }
      }

      let low = best.angle - Math.PI / steps;
      let high = best.angle + Math.PI / steps;

      for (let step = 0; step < 24; step += 1) {
        const midLow = low + (high - low) / 3;
        const midHigh = high - (high - low) / 3;

        const atLow = { x: rx * Math.cos(midLow), y: ry * Math.sin(midLow) };
        const atHigh = { x: rx * Math.cos(midHigh), y: ry * Math.sin(midHigh) };

        if (
          Math.hypot(atLow.x - local.x, atLow.y - local.y) <
          Math.hypot(atHigh.x - local.x, atHigh.y - local.y)
        ) {
          high = midHigh;
        } else {
          low = midLow;
        }
      }

      const angle = (low + high) / 2;
      const at = toWorld(rx * Math.cos(angle), ry * Math.sin(angle));

      return { ...at, t: angle, distance: distance(point, at) };
    },
    length: () => {
      /* Ramanujan's approximation - accurate to a few parts in a million. */
      const h = (rx - ry) ** 2 / (rx + ry) ** 2;

      return Math.PI * (rx + ry) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)));
    },
    sample: (count = 64) => {
      const steps = Math.max(8, Math.floor(count));

      return Array.from({ length: steps + 1 }, (_, index) => {
        const angle = (index / steps) * Math.PI * 2;

        return toWorld(rx * Math.cos(angle), ry * Math.sin(angle));
      });
    },
    withPointAt: (t, point) => ({
      ...ellipseAdapter({
        id,
        centre: c,
        radiusX: rx,
        radiusY: ry,
        rotation: phi,
      }),
      inserted: { x: finite(point?.x), y: finite(point?.y) },
      insertedAngle: finite(t),
    }),
    constraints: () => ({
      determined: true,
      needs: [],
      note: "An ellipse is determined by its centre, two radii and a rotation.",
    }),
  };
}

/* ============================================================
 * RECTANGLE
 * ============================================================ */
export function rectangleAdapter({
  id = "rectangle",
  corner,
  width = 1,
  height = 1,
} = {}) {
  const x = finite(corner?.x);
  const y = finite(corner?.y);
  const w = finite(width, 1);
  const h = finite(height, 1);

  const corners = [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ];

  return {
    ...polylineAdapter({ id, points: corners, closed: true }),
    kind: "rectangle",
    corner: { x, y },
    width: w,
    height: h,
    constraints: () => ({
      determined: true,
      needs: [],
      note: "A rectangle is determined by a corner and two sides.",
    }),
  };
}

/* ============================================================
 * BEZIER CURVE
 * ============================================================ */
export function curveAdapter({
  id = "curve",
  points = [],
  segments = [],
  closed = false,
} = {}) {
  const vertices = (Array.isArray(points) ? points : []).map((point) => ({
    x: finite(point?.x),
    y: finite(point?.y),
  }));

  const cubics = Array.isArray(segments) ? segments : [];

  const sampleCubic = (segment, t) => {
    const u = 1 - t;

    const a = u * u * u;
    const b = 3 * u * u * t;
    const c = 3 * u * t * t;
    const d = t * t * t;

    return {
      x:
        a * finite(segment.from?.x) +
        b * finite(segment.control1?.x) +
        c * finite(segment.control2?.x) +
        d * finite(segment.to?.x),
      y:
        a * finite(segment.from?.y) +
        b * finite(segment.control1?.y) +
        c * finite(segment.control2?.y) +
        d * finite(segment.to?.y),
    };
  };

  const sample = (count = 64) => {
    if (!cubics.length) {
      return vertices.map((point) => ({ ...point }));
    }

    const steps = Math.max(2, Math.floor(count));
    const perSegment = Math.max(2, Math.ceil(steps / cubics.length));

    const list = [];

    cubics.forEach((segment, index) => {
      for (let step = index === 0 ? 0 : 1; step <= perSegment; step += 1) {
        list.push(sampleCubic(segment, step / perSegment));
      }
    });

    return list;
  };

  return {
    id,
    kind: "curve",
    closed: Boolean(closed),
    points: vertices,
    segments: cubics,
    pointAt: (t) => {
      const list = sample(64);

      if (!list.length) {
        return { x: 0, y: 0 };
      }

      const index = Math.max(
        0,
        Math.min(list.length - 1, Math.round(finite(t) * (list.length - 1))),
      );

      return { ...list[index] };
    },
    project: (point) => {
      const list = sample(96);

      let best = { x: 0, y: 0, t: 0, distance: Infinity };

      list.forEach((at, index) => {
        const away = distance(point, at);

        if (away < best.distance) {
          best = {
            ...at,
            t: list.length > 1 ? index / (list.length - 1) : 0,
            distance: away,
          };
        }
      });

      return best;
    },
    length: () => {
      const list = sample(96);

      return list.reduce(
        (sum, point, index) =>
          index ? sum + distance(list[index - 1], point) : 0,
        0,
      );
    },
    sample,
    withPointAt: (t, point) => {
      const at = { x: finite(point?.x), y: finite(point?.y) };
      const list = sample(96);
      const index = Math.max(
        0,
        Math.min(list.length - 1, Math.round(finite(t) * (list.length - 1))),
      );

      const next = [...list];
      next.splice(index, 0, at);

      return {
        ...curveAdapter({ id, points: next, segments: [], closed }),
        inserted: at,
      };
    },
    constraints: () => ({
      determined: vertices.length >= 2,
      needs: vertices.length >= 2 ? [] : ["at least two points"],
    }),
  };
}

/* ============================================================
 * THE REGISTRY
 * ============================================================ */

export const ADAPTERS = Object.freeze({
  line: lineAdapter,
  polyline: polylineAdapter,
  polygon: (options) => polylineAdapter({ ...options, closed: true }),
  circle: circleAdapter,
  arc: arcAdapter,
  ellipse: ellipseAdapter,
  rectangle: rectangleAdapter,
  curve: curveAdapter,
});

/*
 * Build an adapter from a geometry description.
 *
 * THE ELEMENT'S ID WINS OVER THE ADAPTER'S KIND NAME. An adapter names its
 * INTERFACE ("circle"), and a caller that spreads one back over its element
 * would lose the element's own id to that name - so an element that HAS an id
 * keeps it, and only an element without one falls back to the kind.
 */
export function adapterFor(geometry = {}) {
  const kind = String(geometry.kind || geometry.type || "curve");
  const factory = ADAPTERS[kind] || curveAdapter;

  const adapter = factory(geometry);

  return { ...adapter, id: geometry.id || adapter.id };
}

/*
 * The point a student would create by clicking on this geometry.
 *
 * This is the shared answer to "insert a point anywhere on a curve": the
 * adapter projects the click onto its own mathematics, and the shared point
 * model turns that into an anchor or a guide. No adapter is allowed to answer
 * with a sample index or a pixel - only with a model coordinate and its own
 * parameter.
 */
export function pointOnGeometry(
  geometry,
  target,
  { type = "anchor", name = "" } = {},
) {
  const adapter = adapterFor(geometry);
  const projected = adapter.project(target);

  if (!projected || !Number.isFinite(projected.x)) {
    return null;
  }

  return makePoint({
    name,
    type,
    x: projected.x,
    y: projected.y,
    /*
     * THE GEOMETRY'S OWN ID, NOT THE ADAPTER'S. `adapterFor` answers with an
     * adapter whose `id` names the INTERFACE ("circle"), so reading through a
     * spread gave every inserted point the same geometryId and none of them
     * could be traced back to the curve it was placed on.
     */
    geometryId: geometry.id || null,
    parameter: projected.t,
  });
}

export default {
  ADAPTERS,
  adapterFor,
  pointOnGeometry,
  lineAdapter,
  polylineAdapter,
  circleAdapter,
  arcAdapter,
  ellipseAdapter,
  rectangleAdapter,
  curveAdapter,
};

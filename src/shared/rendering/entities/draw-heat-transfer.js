/*
 * ========================================================
 * DRAWING ONE HEAT TRANSFER FEATURE
 * ========================================================
 *
 * The per-type painters for the Heat Transfer workspace. Each function draws
 * into its group, from the context `appendEntity` (entity-render.js) builds,
 * and returns true only to stop the feature being drawn at all - the SAME
 * contract every drawer in this folder keeps.
 *
 * EVERY PAINTER READS THE FEATURE'S OWN GEOMETRY through the model
 * (model/heat-transfer/heat-model.js), so what is drawn is what is stored -
 * and a saved file, a source compile and the canvas cannot disagree about the
 * shape of a wall or the spread of a boundary's symbols.
 *
 * THE DECORATIONS ARE GENERATED, NOT STORED. A boundary's convection arrows, a
 * radiation path's wave and a composite wall's dividers are computed from the
 * feature's points at draw time, so editing a point redraws the whole symbol
 * and nothing is left behind when a variant changes.
 */

import {
  activeZoom,
  createSvgElement,
  dashPatternFor,
  paintColour,
  scaledStrokeWidth,
} from "../svg-primitives.js";
import enggHeatModel from "../../../features/workspace/model/heat-transfer/heat-model.js";
import {
  CONVECTION_BOW_FRACTION,
  CONVECTION_MAX_BOW,
  DEFAULT_MARKER_RADIUS,
  DEFAULT_NODE_RADIUS,
  DEFAULT_SYMBOL_HALF,
  RADIATION_WAVE_AMPLITUDE,
  RADIATION_WAVE_PITCH,
  arrowHead,
  finiteNumber,
  finitePoint,
  normalOf,
  unitVector,
} from "../../../features/workspace/model/heat-transfer/heat-shared.js";
import enggTheme from "../../../components/layout/workspace/theme.js";

function strokeOf(style) {
  return paintColour(style.stroke || enggTheme.defaultLineColour());
}

/*
 * THE CAMERA'S SCALE, FOR THE MARKS WHOSE SIZE IS PART OF THE DRAWING.
 *
 * A world length becomes this many overlay pixels. A stroke width does NOT want
 * it - `scaledStrokeWidth` already divides the zoom back out - but a symbol's
 * radius, a marker and an arrowhead are geometry, so they are multiplied by it
 * to keep their proportion to the objects they sit beside.
 */
function screenScale() {
  return Number(activeZoom) > 0 ? Number(activeZoom) : 1;
}

function lineWidthOf(style) {
  return scaledStrokeWidth(style.lineWidth);
}

function dashOf(style) {
  return dashPatternFor(style.lineType);
}

/* A straight stroke between two world points. */
function strokeSegment(svg, a, b, style, toScreen, extra = {}) {
  if (!finitePoint(a) || !finitePoint(b)) {
    return;
  }

  const from = toScreen(a);
  const to = toScreen(b);
  const dash = dashOf(style);

  svg.appendChild(
    createSvgElement("line", {
      x1: from.x,
      y1: from.y,
      x2: to.x,
      y2: to.y,
      stroke: strokeOf(style),
      "stroke-width": lineWidthOf(style),
      "stroke-linecap": "round",
      ...(dash ? { "stroke-dasharray": dash } : {}),
      ...extra,
    }),
  );
}

/* A polyline through world points, optionally closed. */
function strokePath(
  svg,
  points,
  style,
  toScreen,
  { closed = false, fill = null } = {},
) {
  const valid = (points || []).filter(finitePoint);

  if (valid.length < 2) {
    return;
  }

  const screen = valid.map(toScreen);
  const dash = dashOf(style);

  if (closed || fill) {
    svg.appendChild(
      createSvgElement("polygon", {
        points: screen.map((p) => `${p.x},${p.y}`).join(" "),
        fill: fill || "none",
        stroke: strokeOf(style),
        "stroke-width": lineWidthOf(style),
        "stroke-linejoin": "round",
        ...(dash ? { "stroke-dasharray": dash } : {}),
      }),
    );

    return;
  }

  svg.appendChild(
    createSvgElement("path", {
      d: screen
        .map((p, index) => `${index ? "L" : "M"} ${p.x} ${p.y}`)
        .join(" "),
      fill: "none",
      stroke: strokeOf(style),
      "stroke-width": lineWidthOf(style),
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      ...(dash ? { "stroke-dasharray": dash } : {}),
    }),
  );
}

/*
 * THE STROKE WEIGHT OF A STYLE, IN DRAWING UNITS.
 *
 * `style.lineWidth` may be a preset name ("thin") or a number. This resolves
 * it to the drawing weight the arrowhead is sized from, so the head is as
 * heavy as the line it ends - the same relationship a distributed load's arrow
 * keeps.
 */
function drawingStrokeWeight(style) {
  const stored = style?.lineWidth;

  if (typeof stored === "number" && Number.isFinite(stored) && stored > 0) {
    return stored;
  }

  /* The named presets, in TikZ points, matching the Thickness control. */
  const presets = {
    "ultra-thin": 0.2,
    "very-thin": 0.3,
    thin: 0.4,
    "semi-thick": 0.6,
    thick: 1,
    "very-thick": 1.5,
    "ultra-thick": 2.5,
  };

  const named = typeof stored === "string" ? presets[stored.trim().toLowerCase()] : null;

  /* A Heat Transfer path's own default weight, when nothing is set. */
  return Number.isFinite(named) ? named : 0.4;
}

/*
 * AN ARROWHEAD AT A TIP, pointing along a direction.
 *
 * The head is SIZED FROM THE LINE WEIGHT (via `arrowHead`), not from the length
 * of the path it ends, so it stays compact and proportional - and is DRAWN
 * FILLED, the same solid head every force arrow on the sheet wears, so it can
 * never be confused with, or swallowed by, the line itself.
 *
 * `boundLength` caps the head so it cannot overrun a short path.
 *
 * THE HEAD IS A WORLD SIZE, so it is scaled into overlay pixels like the line
 * weight it is measured from - a head that stayed a fixed number of pixels grew
 * out of proportion to the shaft it ends as the student zoomed out.
 */
function strokeArrowHead(svg, tip, direction, boundLength, style, toScreen) {
  const head = arrowHead(
    tip,
    direction,
    drawingStrokeWeight(style),
    boundLength,
    screenScale(),
  );

  if (!head) {
    return;
  }

  const a = toScreen(head.barbFirst);
  const b = toScreen(head.tip);
  const c = toScreen(head.barbSecond);

  svg.appendChild(
    createSvgElement("polygon", {
      points: `${a.x},${a.y} ${b.x},${b.y} ${c.x},${c.y}`,
      fill: strokeOf(style),
      stroke: "none",
    }),
  );
}



/* ============================================================
 * 1. THE THERMAL REGION
 * ============================================================ */

export function drawThermalRegion({ svg, parentSvg, entity, style, toScreen }) {
  const corners = enggHeatModel.regionCorners(entity);

  if (!corners || corners.length < 4) {
    return true;
  }

  const variant = enggHeatModel.variantOf(entity);
  const filled = style.fillMode === "solid";
  const insulation = variant === "insulation";

  const screen = corners.map(toScreen);
  const dash = dashOf(style);

  svg.appendChild(
    createSvgElement("polygon", {
      points: screen.map((p) => `${p.x},${p.y}`).join(" "),
      fill:
        filled || insulation
          ? paintColour(
              style.fill || style.stroke || enggTheme.defaultLineColour(),
            )
          : "none",
      "fill-opacity": insulation && !filled ? 0.18 : 1,
      stroke: strokeOf(style),
      "stroke-width": lineWidthOf(style),
      "stroke-linejoin": "round",
      ...(dash ? { "stroke-dasharray": dash } : {}),
    }),
  );

  /*
   * AN INSULATION REGION CARRIES ITS HATCH.
   *
   * The zig-zag insulation fill is drawn between the region's two long edges,
   * generated from the corners so a resize re-spreads it. It is drawn in the
   * region's own stroke, so a custom colour follows it.
   */
  if (insulation && !filled) {
    const [a, b, , d] = corners;
    const direction = unitVector(a, b);

    if (direction) {
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      const count = Math.max(
        1,
        Math.round(length / (DEFAULT_SYMBOL_HALF * 1.4)),
      );

      for (let index = 0; index < count; index += 1) {
        const t0 = index / count;
        const t1 = (index + 1) / count;

        const p0 = {
          x: a.x + (b.x - a.x) * t0 + (d.x - a.x) * 0.0,
          y: a.y + (b.y - a.y) * t0 + (d.y - a.y) * 0.0,
        };
        const p1 = {
          x: a.x + (b.x - a.x) * t1 + (d.x - a.x) * 0.0,
          y: a.y + (b.y - a.y) * t1 + (d.y - a.y) * 0.0,
        };

        /* The hatch leans across the region, from the near edge to the far. */
        const lean = { x: (d.x - a.x) * 0.5, y: (d.y - a.y) * 0.5 };

        strokeSegment(
          svg,
          { x: p0.x, y: p0.y },
          { x: p1.x + lean.x, y: p1.y + lean.y },
          style,
          toScreen,
        );
      }
    }
  }

  parentSvg.appendChild(svg);
  return true;
}

/* ============================================================
 * 2. THE WALL / SLAB - EXACTLY TWO PARALLEL LINES
 * ============================================================ */

export function drawWallSlab({ svg, parentSvg, entity, style, toScreen }) {
  const lines = enggHeatModel.wallSlabLines(entity);

  if (!lines) {
    return true;
  }

  /*
   * TWO LINES, AND NOTHING ELSE. No end caps, no internal divisions, no fill -
   * a Wall / Slab is the opposing surfaces of a simplified wall, and that is
   * all it draws.
   */
  lines.forEach((boundary) =>
    strokeSegment(svg, boundary.start, boundary.end, style, toScreen),
  );

  parentSvg.appendChild(svg);
  return true;
}

/* ============================================================
 * 3. THE COMPOSITE WALL
 * ============================================================ */

export function drawCompositeWall({ svg, parentSvg, entity, style, toScreen }) {
  const geometry = enggHeatModel.compositeWallGeometry(entity);

  if (!geometry) {
    return true;
  }

  const filled = style.fillMode === "solid";

  /* The outer rectangle, closed and optionally filled. */
  strokePath(svg, geometry.corners, style, toScreen, {
    closed: true,
    fill: filled
      ? paintColour(style.fill || style.stroke || enggTheme.defaultLineColour())
      : null,
  });

  /*
   * THE INTERNAL DIVIDERS, PERPENDICULAR TO THE LONG DIMENSION.
   *
   * Each is a stroke between its two derived endpoints, so a rotated wall's
   * dividers rotate with it and a resized wall's dividers stay evenly spread
   * between its faces.
   */
  geometry.dividers.forEach((divider) =>
    strokeSegment(svg, divider.start, divider.end, style, toScreen),
  );

  parentSvg.appendChild(svg);
  return true;
}

/* ============================================================
 * 4. THE FIN
 * ============================================================ */

export function drawFin({ svg, parentSvg, entity, style, toScreen }) {
  const geometry = enggHeatModel.finGeometry(entity);

  if (!geometry) {
    return true;
  }

  const filled = style.fillMode === "solid";

  /* The fin's rectangle, closed and optionally filled. */
  strokePath(svg, geometry.corners, style, toScreen, {
    closed: true,
    fill: filled
      ? paintColour(style.fill || style.stroke || enggTheme.defaultLineColour())
      : null,
  });

  parentSvg.appendChild(svg);
  return true;
}

/* ============================================================
 * 5. THE HEAT TRANSFER PATHS
 * ============================================================
 *
 * One path, three geometries. The points are the model; how the path between
 * them is drawn is the variant. The arrowhead sits on the FINAL segment and
 * follows the path's own direction, so editing a point moves the head.
 */
export function drawHeatPath({
  svg,
  parentSvg,
  entity,
  geometry,
  style,
  toScreen,
}) {
  const points = (geometry.points || []).filter(finitePoint);

  if (points.length < 2) {
    return true;
  }

  const variant = enggHeatModel.variantOf(entity);
  const ordered = geometry.reversed ? [...points].reverse() : points;

  /*
   * THE HEAD IS BOUNDED BY THE FINAL SEGMENT, not the whole path.
   *
   * The bound exists only so a very short last segment cannot be overrun by
   * its own head; the ACTUAL size comes from the line weight inside
   * `arrowHead`. A multi-segment path is not one long arrow, so its whole
   * length is the wrong thing to size - or even to bound - a head against.
   */
  const finalSegment = Math.hypot(
    ordered[ordered.length - 1].x - ordered[ordered.length - 2].x,
    ordered[ordered.length - 1].y - ordered[ordered.length - 2].y,
  );

  /*
   * THE RADIATION WAVE'S OWN END, kept so the head can sit ON the wave.
   *
   * The wave is displaced off the route by its amplitude, so its last point is
   * NOT the route's endpoint. Asking the painter for the samples once and using
   * them for both the stroke and the head is what stops the head drifting beside
   * the wave.
   */
  let radiationEnd = null;

  if (variant === "convection") {
    /* A smooth streamline through the points, with the head at its end. */
    strokeSmoothPath(svg, ordered, style, toScreen);
  } else if (variant === "radiation") {
    /* A generated radiation wave along the route, then the head - ON it. */
    const samples = radiationWaveSamples(ordered);

    strokePath(svg, samples, style, toScreen);

    radiationEnd = radiationWaveEnd(samples);
  } else {
    /* Conduction: straight connected segments. */
    strokePath(svg, ordered, style, toScreen);
  }

  /*
   * THE ARROWHEAD SITS AT THE TERMINAL ENDPOINT AND FOLLOWS THE FINAL SEGMENT.
   *
   * Conduction and radiation point along the last straight chord. A convection
   * streamline is a SMOOTH curve, so its true endpoint tangent is the curve's
   * own - computed from the same Catmull-Rom control the curve is drawn with,
   * so the head is tangent to the line it ends rather than to a chord that the
   * curve has already left.
   */
  const last = ordered[ordered.length - 1];
  const previous = ordered[ordered.length - 2];

  /*
   * THE HEAD'S DIRECTION.
   *
   * Conduction and Radiation run straight along their final chord, so the chord
   * IS their end direction. A Convection Flow is a smooth curve, so its head
   * follows the CURVE's true end tangent - the direction the last Bezier arrives
   * along - which is why it is asked of the streamline rather than the chord.
   */
  /*
   * EACH VARIANT'S HEAD ANCHOR AND DIRECTION:
   *
   *   RADIATION   on the WAVE's last sample, along the wave's final travel.
   *   CONVECTION  on the route's end, along the curve's true end tangent.
   *   CONDUCTION  on the route's end, along the final straight chord.
   */
  const headAnchor =
    variant === "radiation" && radiationEnd
      ? radiationEnd.tip
      : last;

  const direction =
    variant === "radiation" && radiationEnd
      ? radiationEnd.direction
      : variant === "convection"
        ? streamlineEndDirection(ordered)
        : unitVector(previous, last);

  if (direction) {
    strokeArrowHead(svg, headAnchor, direction, finalSegment, style, toScreen);
  }

  parentSvg.appendChild(svg);
  return true;
}



/*
 * THE CONVECTION FLOW'S SMOOTH STREAMLINE, AS CUBIC BEZIER SEGMENTS.
 *
 * ========================================================
 * WHY CENTRIPETAL CATMULL-ROM, AND WHY NOT THE TWO OLD APPROACHES
 * ========================================================
 *
 * A Convection Flow must READ as a smooth curve - visibly unlike a solid
 * Conduction Path - while passing exactly through every point the student
 * dragged, and without the loops and overshoots the earlier spline produced.
 *
 *   UNIFORM CATMULL-ROM (what the old code used) bulges between points and can
 *   LOOP or cusp where the spacing changes - a short hop followed by a long
 *   run whips the curve past itself. That was the "unexpected curvature".
 *
 *   ROUNDING ONLY THE CORNERS leaves a single dragged segment perfectly
 *   straight, so a one-segment Convection Flow looked EXACTLY like a
 *   Conduction Path - the reported symptom this replaces.
 *
 * CENTRIPETAL CATMULL-ROM (alpha = 0.5) is the standard cure: it is provably
 * free of cusps and self-intersections for any point spacing, it interpolates
 * every point exactly, and it is smooth (C1) at every join. The curve BOWS
 * gently through each segment, which is what makes Convection visibly a curve
 * even on one segment - and the bow is a bounded, predictable one, never a
 * loop.
 *
 * Each segment is returned as a cubic Bezier in WORLD coordinates - start,
 * control1, control2, end - so the canvas and the source writer draw exactly
 * the same streamline.
 */
export function streamlineSegments(points) {
  const pts = (Array.isArray(points) ? points : []).filter(finitePoint);

  if (pts.length < 2) {
    return [];
  }

  /*
   * A TWO-POINT ROUTE IS A GENTLE BOW, not a straight line.
   *
   * With no interior point to bend toward, the controls are pushed a fraction
   * of the length to one side, so the curve arcs smoothly - clearly a stream
   * line and not a rule — which is what makes a single-segment Convection Flow
   * visibly different from Conduction.
   */
  if (pts.length === 2) {
    const [a, b] = pts;
    const direction = unitVector(a, b);

    if (!direction) {
      return [];
    }

    const length = Math.hypot(b.x - a.x, b.y - a.y);
    const normal = normalOf(direction);

    /* A shallow, bounded bow: never more than a small fraction of the run. */
    const bow = Math.min(CONVECTION_BOW_FRACTION * length, CONVECTION_MAX_BOW);

    const midBase = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const peak = { x: midBase.x + normal.x * bow, y: midBase.y + normal.y * bow };

    /* Two cubics through the peak, so it is one smooth arc, not a kink. */
    const first = {
      start: { ...a },
      control1: { x: a.x + (peak.x - a.x) * 0.55, y: a.y + (peak.y - a.y) * 0.55 },
      control2: { x: peak.x - direction.x * length * 0.18, y: peak.y - direction.y * length * 0.18 },
      end: { ...peak },
    };
    const second = {
      start: { ...peak },
      control1: { x: peak.x + direction.x * length * 0.18, y: peak.y + direction.y * length * 0.18 },
      control2: { x: b.x + (peak.x - b.x) * 0.55, y: b.y + (peak.y - b.y) * 0.55 },
      end: { ...b },
    };

    return [first, second];
  }

  /*
   * THE ENDPOINTS ARE EXTENDED BY REFLECTION.
   *
   * A Catmull-Rom segment needs a point on BOTH sides of it. At the first and
   * last segment only one exists, and reusing the end point itself made the
   * final tangent degenerate - `control2` landed exactly ON the last point, so
   * the curve arrived with no direction and the arrowhead had no heading to
   * point along. Reflecting the neighbour across the endpoint (`2·end - near`)
   * is the standard fix: the phantom point lies on the line the curve came in
   * on, so the end tangent is the real direction of travel and the curve does
   * not swerve to reach it.
   */
  const mirrored = (anchor, neighbour) => ({
    x: 2 * anchor.x - neighbour.x,
    y: 2 * anchor.y - neighbour.y,
  });

  const extended = [
    mirrored(pts[0], pts[1]),
    ...pts,
    mirrored(pts[pts.length - 1], pts[pts.length - 2]),
  ];

  const knots = centripetalKnots(extended);
  const segments = [];

  /* The real points are `extended` offset by one (the leading phantom). */
  const offset = 1;

  for (let index = 0; index < pts.length - 1; index += 1) {
    const at = index + offset;

    const p0 = extended[at - 1];
    const p1 = extended[at];
    const p2 = extended[at + 1];
    const p3 = extended[at + 2];

    const t0 = knots[at - 1];
    const t1 = knots[at];
    const t2 = knots[at + 1];
    const t3 = knots[at + 2];

    const control1 = centripetalControl(p0, p1, p2, p3, t0, t1, t2, t3, true);
    const control2 = centripetalControl(p0, p1, p2, p3, t0, t1, t2, t3, false);

    segments.push({
      start: { ...p1 },
      control1,
      control2,
      end: { ...p2 },
    });
  }

  return segments;
}

/*
 * The centripetal knot sequence: ti = t(i-1) + |Pi - Pi-1|^0.5.
 *
 * Alpha = 0.5 is what makes the spline free of cusps and loops; the exponent
 * is the whole guarantee, so it is written once here and used by both control
 * points.
 */
function centripetalKnots(points) {
  const knots = [0];

  for (let index = 1; index < points.length; index += 1) {
    const distance = Math.hypot(
      points[index].x - points[index - 1].x,
      points[index].y - points[index - 1].y,
    );

    knots.push(knots[index - 1] + Math.sqrt(Math.max(distance, 1e-9)));
  }

  return knots;
}

/*
 * ONE BEZIER CONTROL POINT OF A CENTRIPETAL CATMULL-ROM SEGMENT.
 *
 * The standard non-uniform Catmull-Rom to Bezier conversion. For the segment
 * from `p1` to `p2` inside the knot sequence t0 < t1 < t2 < t3, the tangents
 * at the two endpoints are
 *
 *     m1 = (p1 - p0)/(t1 - t0) - (p2 - p0)/(t2 - t0) + (p2 - p1)/(t2 - t1)
 *     m2 = (p2 - p1)/(t2 - t1) - (p3 - p1)/(t3 - t1) + (p3 - p2)/(t3 - t2)
 *
 * and the controls are `p1 + m1*(t2-t1)/3` and `p2 - m2*(t2-t1)/3`. Those two
 * share one tangent direction at every join, which is what makes the curve C1 -
 * the property that stops it kinking.
 *
 * `p0,p1,p2,p3` are the four surrounding points and `t0..t3` their knots;
 * `isOutgoing` selects the control leaving `p1` (c1) or the one arriving at
 * `p2` (c2).
 */
function centripetalControl(p0, p1, p2, p3, t0, t1, t2, t3, isOutgoing) {
  const safe = (value) => (Math.abs(value) < 1e-9 ? 1e-9 : value);

  const tangent = isOutgoing
    ? {
        x:
          (p1.x - p0.x) / safe(t1 - t0) -
          (p2.x - p0.x) / safe(t2 - t0) +
          (p2.x - p1.x) / safe(t2 - t1),
        y:
          (p1.y - p0.y) / safe(t1 - t0) -
          (p2.y - p0.y) / safe(t2 - t0) +
          (p2.y - p1.y) / safe(t2 - t1),
      }
    : {
        x:
          (p2.x - p1.x) / safe(t2 - t1) -
          (p3.x - p1.x) / safe(t3 - t1) +
          (p3.x - p2.x) / safe(t3 - t2),
        y:
          (p2.y - p1.y) / safe(t2 - t1) -
          (p3.y - p1.y) / safe(t3 - t1) +
          (p3.y - p2.y) / safe(t3 - t2),
      };

  const span = safe(t2 - t1) / 3;

  const base = isOutgoing ? p1 : p2;
  const sign = isOutgoing ? 1 : -1;

  return {
    x: base.x + sign * tangent.x * span,
    y: base.y + sign * tangent.y * span,
  };
}

/*
 * THE CONVECTION FLOW, DRAWN.
 *
 * The centripetal Catmull-Rom streamline above, as one SVG path of cubic
 * Beziers. It passes through every point the student dragged, is smooth at
 * every join, and is visibly a CURVE even on a single segment - so it never
 * falls back to the solid Conduction appearance.
 */
function strokeSmoothPath(svg, points, style, toScreen) {
  const segments = streamlineSegments(points);

  if (!segments.length) {
    return;
  }

  const at = (point) => toScreen(point);
  const first = segments[0].start;
  const start = at(first);

  let d = `M ${start.x} ${start.y}`;

  segments.forEach((segment) => {
    const c1 = at(segment.control1);
    const c2 = at(segment.control2);
    const end = at(segment.end);

    d += ` C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${end.x} ${end.y}`;
  });

  const dash = dashOf(style);

  svg.appendChild(
    createSvgElement("path", {
      d,
      fill: "none",
      stroke: strokeOf(style),
      "stroke-width": lineWidthOf(style),
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      ...(dash ? { "stroke-dasharray": dash } : {}),
    }),
  );
}

/*
 * THE END TANGENT OF THE CONVECTION STREAMLINE.
 *
 * The arrowhead must follow the direction the CURVE actually arrives along, not
 * the straight chord beneath it - otherwise the head points somewhere the line
 * is not. A cubic's end tangent is `end - control2`, which is exactly the
 * direction the last Bezier leaves its control toward its endpoint.
 */
function streamlineEndDirection(points) {
  const segments = streamlineSegments(points);

  if (!segments.length) {
    return null;
  }

  const last = segments[segments.length - 1];

  return unitVector(last.control2, last.end);
}

/*
 * THE RADIATION WAVE.
 *
 * A sine wave along the route, generated at draw time from the points. TWO
 * things make it read as ONE continuous wave rather than a series of separate
 * wiggles:
 *
 *   PHASE CARRIES ACROSS SEGMENTS. The phase is a running total of distance
 *   travelled, so the wave does not restart at each vertex - the crests stay
 *   evenly spaced through a corner.
 *
 *   SAMPLING IS BY ARC LENGTH, not by a count per segment, so the wavelength
 *   and amplitude are the same whatever the segment lengths are.
 *
 * The amplitude is perpendicular to the LOCAL direction and the pitch is a
 * drawing amount, so the pattern regenerates when a point moves and reads the
 * same at every zoom.
 *
 * THE SAMPLES ARE THE WAVE'S REAL GEOMETRY.
 *
 * They are returned, not just painted, because the wave does NOT end on the
 * route's endpoint: the last sample is displaced off the route line by
 * `sin(phase) * amplitude`, exactly like every other crest and trough. The
 * arrowhead has to sit on THAT point - see `radiationWaveSamples` and its use
 * in `drawHeatPath` - or it floats beside the wave on the wrong side of it.
 */
export function radiationWaveSamples(points) {
  const samples = [];

  /* A running distance, so the phase does not reset at a vertex. */
  let travelled = 0;

  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1];
    const b = points[index];
    const direction = unitVector(a, b);

    if (!direction) {
      continue;
    }

    const normal = normalOf(direction);
    const length = Math.hypot(b.x - a.x, b.y - a.y);

    /* Four samples per quarter wave: smooth without an unbounded point count. */
    const steps = Math.max(2, Math.ceil(length / (RADIATION_WAVE_PITCH / 4)));

    for (let step = index === 1 ? 0 : 1; step <= steps; step += 1) {
      const t = step / steps;
      const along = travelled + t * length;
      const wobble =
        Math.sin((along / RADIATION_WAVE_PITCH) * Math.PI * 2) *
        RADIATION_WAVE_AMPLITUDE;

      samples.push({
        x: a.x + (b.x - a.x) * t + normal.x * wobble,
        y: a.y + (b.y - a.y) * t + normal.y * wobble,
      });
    }

    travelled += length;
  }

  return samples;
}



/*
 * THE ARROWHEAD'S ANCHOR ON A RADIATION WAVE.
 *
 * The head sits on the wave's OWN last sample - not on the route's endpoint -
 * so it is on the line, at the terminal trough or crest, rather than floating
 * beside it. Its direction is the wave's final travel direction, computed from
 * the last two samples, so it points the way the wave is going at its end
 * instead of along the straight chord the wave has already left.
 *
 * Returns { tip, direction } or null for a degenerate wave.
 */
function radiationWaveEnd(samples) {
  if (!Array.isArray(samples) || samples.length < 2) {
    return null;
  }

  const tip = samples[samples.length - 1];
  const before = samples[samples.length - 2];
  const direction = unitVector(before, tip);

  return direction ? { tip: { x: tip.x, y: tip.y }, direction } : null;
}

/* ============================================================
 * 6. THE THERMAL TRANSFER ARROWS
 * ============================================================
 *
 * One arrow geometry and an attached text node. The variant decides the
 * quantity and the default notation; the two are never interchangeable.
 */
export function drawThermalArrow({
  svg,
  parentSvg,
  entity,
  geometry,
  style,
  toScreen,
}) {
  const start = geometry.start;
  const end = geometry.end;

  if (!finitePoint(start) || !finitePoint(end)) {
    return true;
  }

  const ordered = geometry.reversed
    ? { from: end, to: start }
    : { from: start, to: end };
  const direction = unitVector(ordered.from, ordered.to);

  if (!direction) {
    return true;
  }

  const length = Math.hypot(
    ordered.to.x - ordered.from.x,
    ordered.to.y - ordered.from.y,
  );

  strokeSegment(svg, ordered.from, ordered.to, style, toScreen);
  strokeArrowHead(svg, ordered.to, direction, length, style, toScreen);

    parentSvg.appendChild(svg);
  return true;
}

/* ============================================================
 * 7. THE THERMAL BOUNDARIES
 * ============================================================
 *
 * One boundary segment and its generated decorations. The variant decides the
 * marks; the side decides which face they are drawn on; the spacing is read
 * from the feature, so a resized boundary keeps its symbols evenly spread.
 */
export function drawThermalBoundary({
  svg,
  parentSvg,
  entity,
  geometry,
  style,
  toScreen,
}) {
  const start = geometry.start;
  const end = geometry.end;

  if (!finitePoint(start) || !finitePoint(end)) {
    return true;
  }

  /* The boundary line itself. */
  strokeSegment(svg, start, end, style, toScreen);

  /* Its generated decorations, on the chosen side. */
  const decorations = enggHeatModel.boundaryDecorations(entity);

  decorations.forEach((mark) => {
    if (mark.kind === "arrow") {
      strokeSegment(svg, mark.points[0], mark.points[1], style, toScreen);
      strokeArrowHead(
        svg,
        mark.tip,
        mark.direction,
        DEFAULT_SYMBOL_HALF,
        style,
        toScreen,
      );
    } else {
      strokePath(svg, mark.points, style, toScreen);
    }
  });

  parentSvg.appendChild(svg);
  return true;
}

/* ============================================================
 * 8. THE THERMAL CONTACT / INTERFACE
 * ============================================================ */

export function drawThermalContact({
  svg,
  parentSvg,
  entity,
  geometry,
  style,
  toScreen,
}) {
  if (!finitePoint(geometry.start) || !finitePoint(geometry.end)) {
    return true;
  }

  strokeSegment(svg, geometry.start, geometry.end, style, toScreen);

  parentSvg.appendChild(svg);
  return true;
}

/* ============================================================
 * 9. THE HEAT SOURCE / SINK
 * ============================================================
 *
 * A circle with a directional marker through it - an arrow pointing INTO the
 * symbol for a source, OUT of it for a sink - and an attached Q̇ label. The
 * parts are drawn from the one frame, so they move and rotate together.
 */
export function drawSourceSink({
  svg,
  parentSvg,
  entity,
  geometry,
  style,
  toScreen,
}) {
  const center = geometry.center;

  if (!finitePoint(center)) {
    return true;
  }

  const size = Math.max(1, finiteNumber(geometry.size, DEFAULT_SYMBOL_HALF));
  const rotation = (finiteNumber(geometry.rotation, 0) * Math.PI) / 180;
  const axis = { x: Math.cos(rotation), y: Math.sin(rotation) };
  const variant = enggHeatModel.variantOf(entity);

  const screen = toScreen(center);

  svg.appendChild(
    createSvgElement("circle", {
      cx: screen.x,
      cy: screen.y,
      r: size * (toScreen({ x: 1, y: 0 }).x - toScreen({ x: 0, y: 0 }).x),
      fill:
        style.fillMode === "solid"
          ? paintColour(style.fill || strokeOf(style))
          : "none",
      stroke: strokeOf(style),
      "stroke-width": lineWidthOf(style),
    }),
  );

  /*
   * THE DIRECTIONAL MARKER.
   *
   * A source's arrow points INWARD to the centre; a sink's points OUTWARD from
   * it. The convention is the geometry, not the colour, so the two read in
   * monochrome.
   */
  const reach = size * 2;
  const from = { x: center.x - axis.x * reach, y: center.y - axis.y * reach };
  const to = { x: center.x + axis.x * reach, y: center.y + axis.y * reach };

  if (variant === "sink") {
    strokeSegment(svg, center, to, style, toScreen);
    strokeArrowHead(svg, to, axis, reach, style, toScreen);
  } else {
    strokeSegment(svg, from, center, style, toScreen);
    strokeArrowHead(svg, center, axis, reach, style, toScreen);
  }

  parentSvg.appendChild(svg);
  return true;
}

/* ============================================================
 * 10. THE THERMAL CIRCUIT NODE
 * ============================================================
 *
 * A small connection dot with an attached editable label. The dot is the
 * connection geometry a connector snaps to; the label sits beside it.
 */
export function drawCircuitNode({
  svg,
  parentSvg,
  entity,
  geometry,
  style,
  toScreen,
}) {
  const center = geometry.center;

  if (!finitePoint(center)) {
    return true;
  }

  const radius = Math.max(
    0.5,
    finiteNumber(geometry.radius, DEFAULT_NODE_RADIUS),
  );
  const screen = toScreen(center);
  const scale = toScreen({ x: 1, y: 0 }).x - toScreen({ x: 0, y: 0 }).x;

  void scale;

  svg.appendChild(
    createSvgElement("circle", {
      cx: screen.x,
      cy: screen.y,
      r: radius * screenScale(),
      fill: strokeOf(style),
      stroke: strokeOf(style),
      "stroke-width": lineWidthOf(style),
    }),
  );

  parentSvg.appendChild(svg);
  return true;
}

/* ============================================================
 * 11. THE THERMAL CIRCUIT ELEMENTS
 * ============================================================
 *
 * A resistor's zig-zag or a capacitor's two plates between two connection
 * ports, plus the lead to each port. The ports and the symbol are derived from
 * the one frame, so rotating the element rotates the ports with it.
 */
export function drawCircuitElement({
  svg,
  parentSvg,
  entity,
  geometry,
  style,
  toScreen,
}) {
  const center = geometry.center;

  if (!finitePoint(center)) {
    return true;
  }

  const size = Math.max(1, finiteNumber(geometry.size, DEFAULT_SYMBOL_HALF));
  const rotation = (finiteNumber(geometry.rotation, 0) * Math.PI) / 180;
  const axis = { x: Math.cos(rotation), y: Math.sin(rotation) };
  const normal = normalOf(axis);
  const variant = enggHeatModel.variantOf(entity);

  const ports = enggHeatModel.circuitElementPorts(entity);

  if (!ports) {
    return true;
  }

  const at = (along, sideways) => ({
    x: center.x + axis.x * along + normal.x * sideways,
    y: center.y + axis.y * along + normal.y * sideways,
  });

  /* The leads from each port to the symbol body. */
  strokeSegment(svg, ports.a, at(-size, 0), style, toScreen);
  strokeSegment(svg, at(size, 0), ports.b, style, toScreen);

  if (variant === "capacitance") {
    /* Two parallel plates, perpendicular to the lead. */
    const gap = size * 0.3;
    const plate = size * 0.9;

    strokeSegment(svg, at(-gap, -plate), at(-gap, plate), style, toScreen);
    strokeSegment(svg, at(gap, -plate), at(gap, plate), style, toScreen);
  } else {
    /* A resistor's zig-zag between the two leads. */
    const peaks = 6;
    const amplitude = size * 0.55;
    const points = [];

    for (let index = 0; index <= peaks; index += 1) {
      const along = -size + (2 * size * index) / peaks;
      const sideways =
        index === 0 || index === peaks
          ? 0
          : index % 2 === 0
            ? -amplitude
            : amplitude;

      points.push(at(along, sideways));
    }

    strokePath(svg, points, style, toScreen);
  }

  parentSvg.appendChild(svg);
  return true;
}

/* ============================================================
 * 12. THE TEMPERATURE MARKER
 * ============================================================
 *
 * A small point marker with its attached temperature label. The marker is the
 * geometry; the label is the editable text node beside it.
 */
export function drawTemperatureMarker({
  svg,
  parentSvg,
  entity,
  geometry,
  style,
  toScreen,
}) {
  const center = geometry.center;

  if (!finitePoint(center)) {
    return true;
  }

  const radius = Math.max(
    0.5,
    finiteNumber(geometry.radius, DEFAULT_MARKER_RADIUS),
  );
  const screen = toScreen(center);
  const scale = toScreen({ x: 1, y: 0 }).x - toScreen({ x: 0, y: 0 }).x;

  svg.appendChild(
    createSvgElement("circle", {
      cx: screen.x,
      cy: screen.y,
      r: radius * scale,
      fill: "none",
      stroke: strokeOf(style),
      "stroke-width": lineWidthOf(style),
    }),
  );

  /* The marker's cross, so the point reads at every zoom. */
  strokeSegment(
    svg,
    { x: center.x - radius, y: center.y },
    { x: center.x + radius, y: center.y },
    style,
    toScreen,
  );
  strokeSegment(
    svg,
    { x: center.x, y: center.y - radius },
    { x: center.x, y: center.y + radius },
    style,
    toScreen,
  );

  parentSvg.appendChild(svg);
  return true;
}

/* ============================================================
 * 13. THE ISOTHERM
 * ============================================================
 *
 * A smooth constant-temperature contour through the student's control points.
 * A genuine editable curve, never a static illustration.
 */
export function drawIsotherm({
  svg,
  parentSvg,
  entity,
  geometry,
  style,
  toScreen,
}) {
  const points = (geometry.points || []).filter(finitePoint);

  if (points.length < 2) {
    return true;
  }

  if (geometry.closed) {
    strokePath(svg, points, style, toScreen, { closed: true });
  } else {
    strokeSmoothPath(svg, points, style, toScreen);
  }

  parentSvg.appendChild(svg);
  return true;
}

/* ============================================================
 * 14. THE CONTROL VOLUME BOUNDARY
 * ============================================================
 *
 * A dashed closed rectangle around a system. An annotation object: it never
 * absorbs, modifies or rearranges the objects it encloses.
 */
export function drawControlVolume({ svg, parentSvg, entity, style, toScreen }) {
  const corners = enggHeatModel.controlVolumeCorners(entity);

  if (!corners || corners.length < 4) {
    return true;
  }

  const screen = corners.map(toScreen);

  /*
   * THE BOUNDARY IS DASHED BY CONVENTION. A Control Volume is an annotation,
   * so its line is dashed unless the student has chosen a line style of their
   * own - the dash is the mark of the kind, exactly as a construction line's
   * dash is.
   */
  const dash = dashOf(style) || "3 2";

  svg.appendChild(
    createSvgElement("polygon", {
      points: screen.map((p) => `${p.x},${p.y}`).join(" "),
      fill: "none",
      stroke: strokeOf(style),
      "stroke-width": lineWidthOf(style),
      "stroke-linejoin": "round",
      "stroke-dasharray": dash,
    }),
  );

  parentSvg.appendChild(svg);
  return true;
}

/* ============================================================
 * THE RENDERER TABLE
 * ============================================================
 *
 * One { matches, draw } pair per Heat Transfer type, in the shape the
 * entity-render dispatch reads. A new Heat Transfer type adds its painter
 * here and is drawn without a second edit.
 */
export const HEAT_RENDERERS = [
  {
    matches: (entity) => entity.type === enggHeatModel.HEAT_TYPES.region,
    draw: drawThermalRegion,
  },
  {
    matches: (entity) => entity.type === enggHeatModel.HEAT_TYPES.wallSlab,
    draw: drawWallSlab,
  },
  {
    matches: (entity) => entity.type === enggHeatModel.HEAT_TYPES.compositeWall,
    draw: drawCompositeWall,
  },
  {
    matches: (entity) => entity.type === enggHeatModel.HEAT_TYPES.fin,
    draw: drawFin,
  },
  {
    matches: (entity) => entity.type === enggHeatModel.HEAT_TYPES.heatPath,
    draw: drawHeatPath,
  },
  {
    matches: (entity) => entity.type === enggHeatModel.HEAT_TYPES.thermalArrow,
    draw: drawThermalArrow,
  },
  {
    matches: (entity) =>
      entity.type === enggHeatModel.HEAT_TYPES.thermalBoundary,
    draw: drawThermalBoundary,
  },
  {
    matches: (entity) =>
      entity.type === enggHeatModel.HEAT_TYPES.thermalContact,
    draw: drawThermalContact,
  },
  {
    matches: (entity) => entity.type === enggHeatModel.HEAT_TYPES.sourceSink,
    draw: drawSourceSink,
  },
  {
    matches: (entity) => entity.type === enggHeatModel.HEAT_TYPES.circuitNode,
    draw: drawCircuitNode,
  },
  {
    matches: (entity) =>
      entity.type === enggHeatModel.HEAT_TYPES.circuitElement,
    draw: drawCircuitElement,
  },
  {
    matches: (entity) =>
      entity.type === enggHeatModel.HEAT_TYPES.temperatureMarker,
    draw: drawTemperatureMarker,
  },
  {
    matches: (entity) => entity.type === enggHeatModel.HEAT_TYPES.isotherm,
    draw: drawIsotherm,
  },
  {
    matches: (entity) => entity.type === enggHeatModel.HEAT_TYPES.controlVolume,
    draw: drawControlVolume,
  },
];

export default {
  HEAT_RENDERERS,
  drawThermalRegion,
  drawWallSlab,
  drawCompositeWall,
  drawFin,
  drawHeatPath,
  drawThermalArrow,
  drawThermalBoundary,
  drawThermalContact,
  drawSourceSink,
  drawCircuitNode,
  drawCircuitElement,
  drawTemperatureMarker,
  drawIsotherm,
  drawControlVolume,
};

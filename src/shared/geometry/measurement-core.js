/*
 * Measurement core: what each feature type can be measured and labelled as.
 *
 * This is the shared layer the whole dimension and annotation system
 * sits on. It exists because the alternative - a chain of `if
 * (feature === beam)` checks inside the dimension tool - has to be
 * rewritten every time a feature type is added, and because it puts
 * the knowledge of what a Beam MEANS in the dimension tool rather
 * than with the Beam.
 *
 * THE CAPABILITY IDEA
 * -------------------
 * Every feature type registers what it supports:
 *
 *     dimension candidates   linear, horizontal, vertical, aligned,
 *                            angular, radius, diameter, arc-length,
 *                            coordinate
 *     annotation candidates  what can be said about it
 *     measurement anchors    the real points, edges and faces the
 *                            measurement is taken FROM
 *
 * The dimension and annotation tools ask "what can this measure?" and
 * never ask "what type is this?". A future Spring, Gear or Weld adds
 * dimension support by implementing the same interface and
 * registering it - not by editing the dimension system.
 *
 * THE IMPORTANT RULE: REAL FEATURES, NOT APPROXIMATIONS
 * ----------------------------------------------------
 * A Beam is dimensioned from the Beam's own geometry. It is NOT
 * decomposed into generic lines, because doing so would mean the
 * measurement came from something that is not on the drawing, and a
 * dimension that describes a shape that does not exist is worse than
 * no dimension.
 *
 * That is why every anchor this module returns names the feature it
 * came from and the part of it (`beam.start`, `shaft.surface`,
 * `load.profile`). A dimension built from these anchors refers back
 * to the real feature, so the feature staying a Beam is what makes
 * the association work - and the requirement that dimensioning must
 * never convert a source feature is satisfied by construction rather
 * than by remembering not to.
 *
 * SCREEN, WORLD, AND REAL UNITS
 * -----------------------------
 * Everything here works in WORLD coordinates - the drawing's own
 * units. It is the measurement module, not the viewport, and it must
 * never see screen pixels or a zoom. Values are converted to real
 * units by the existing scale module at the very last moment, which
 * is what makes zooming to 200% change nothing about a 100 mm line.
 *
 * PERFORMANCE: DEPENDENCY-AWARE BY CONSTRUCTION
 * ---------------------------------------------
 * Nothing here caches or recomputes a whole document. Callers ask
 * about ONE feature and get that feature's answer, so editing a line
 * recalculates only the dimensions attached to that line. The cost of
 * an update is proportional to the number of things attached to the
 * thing that changed, not to the size of the drawing.
 */
import enggDrawingState from "../model/drawing-state.js";
import enggFeatureGeometry from "./feature-geometry.js";

/*
 * The dimension types the system understands.
 *
 * Named once and used everywhere - by the tools, the model, the
 * renderer and the file - so that a dimension type can never be
 * spelled one way in the model and another in a file or a renderer
 * branch.
 */
const DIMENSION_TYPES = {
  linear: {
    label: "Length",
    /*
     * A measurement in units. Lengths are dimensioned with extension
     * lines and witness lines because that is the engineering
     * convention; the same drawing read as a bare number with ticks
     * at each end is not a dimension anyone is used to seeing.
     */
    unit: true,
    graphic: "linear"
  },
  horizontal: {
    label: "Horizontal",
    unit: true,
    graphic: "linear"
  },
  vertical: {
    label: "Vertical",
    unit: true,
    graphic: "linear"
  },
  aligned: {
    label: "Aligned",
    unit: true,
    graphic: "linear"
  },
  angular: {
    label: "Angle",

    /*
     * Angles are dimensionless and must not carry a unit suffix.
     * "30 mm°" is meaningless and its absence is part of what makes
     * an angle dimension read as one.
     */
    unit: false,
    graphic: "angular"
  },
  radius: {
    label: "Radius",
    unit: true,

    /*
     * The R prefix is part of the measurement, not decoration.
     *
     * Written hard against the number - "R25 mm" - because that is how an
     * engineering drawing states a radius, and the space this used to carry
     * ("R 25 mm") reads as a separate word rather than as the symbol that
     * gives the number its meaning.
     */
    prefix: "R",
    graphic: "radial"
  },
  diameter: {
    label: "Diameter",
    unit: true,

    /*
     * "Ø50 mm", not "Ø 50 mm": the diameter symbol qualifies the number
     * and is set against it, exactly as R is for a radius.
     */
    prefix: "Ø",
    graphic: "radial"
  },

  /*
   * A PERPENDICULAR DISTANCE FROM A POINT TO A LINE.
   *
   * A type of its own rather than a flavour of "aligned", because the two
   * measure different things. An aligned dimension is the straight distance
   * between its two points; a point-to-line dimension is the perpendicular
   * distance from the point to the line's INFINITE direction, which is
   * shorter whenever the foot of the perpendicular falls outside the line's
   * drawn extent - and is the number a reader checking clearance expects.
   *
   * Its references are three: the point, then the line's two ends. The two
   * ends are kept so the value follows the line when it moves or rotates,
   * which is the same associativity every other measurement has.
   */
  "point-line": {
    label: "Distance",
    unit: true,
    graphic: "linear"
  },
  "arc-length": {
    label: "Arc length",
    unit: true,
    prefix: "",
    graphic: "linear"
  },
  coordinate: {
    label: "Coordinate",
    unit: true,
    graphic: "linear"
  }
};

/*
 * Which dimension types are angular.
 *
 * Read from the type table rather than restated, so a future
 * angular type does not need adding here as well.
 */
function isAngular(type) {
  return (
    DIMENSION_TYPES[type]?.graphic === "angular"
  );
}

/*
 * ========================================================
 * REGISTRY
 * ========================================================
 */

/*
 * Per-type capabilities, keyed by feature type.
 *
 * Populated by register() below. The ANNOTATE_TYPES table supplies
 * the defaults for every type EnggDraw already has, so a feature
 * that has not been given special treatment is still dimensionable
 * in the obvious generic ways - its own extent - rather than being
 * excluded because nobody wrote a case for it.
 */
const registry = new Map();

/*
 * Describe what a feature type supports.
 *
 *   dimensions   candidate measurements, most useful first
 *   annotations   values that can be stated about it
 *   anchors       resolves a named anchor to a world point
 *   value         resolves an annotation's current value
 *
 * `anchors` is the important one. It maps a NAME to a point in the
 * feature's current geometry, so a dimension refers to a feature by
 * "the beam's start" rather than by a copied coordinate. That is
 * what makes the dimension associative: the point is looked up each
 * time it is drawn, so a beam that moves is measured at its new
 * position without the dimension being touched.
 */
function register(
  type,
  capabilities
) {
  registry.set(type, {
    dimensions: [],
    annotations: [],
    anchors: null,
    value: null,
    ...capabilities,
    type
  });

  return registry.get(type);
}

function capabilitiesFor(type) {
  return (
    registry.get(type) ||
    registry.get("__generic__")
  );
}

function known(type) {
  return registry.has(type);
}

/*
 * ========================================================
 * ANCHOR RESOLUTION
 * ========================================================
 */

/*
 * Resolve a named anchor on a feature to a world point.
 *
 * Returns null for anything unresolvable, which is a real and
 * expected answer: an anchor can stop making sense if the feature
 * changes shape. A dimension whose anchor can no longer be resolved
 * is marked unresolved rather than shown as a stale number.
 */
function resolveAnchor(
  object,
  anchorName
) {
  if (
    !object ||
    typeof anchorName !== "string"
  ) {
    return null;
  }

  /*
   * A POINT ON AN ENTITY IS A PARAMETRISED ANCHOR.
   *
   * "pointOnEntity@0.37" names a position 37% of the way along a
   * straight feature. It is resolved from the feature's CURRENT ends
   * every time, so a dimension that references a point in the middle of
   * a beam follows the beam when it moves, rotates or changes length - a
   * stored coordinate would not.
   *
   * It is handled before the capabilities lookup because no capability
   * can enumerate every fraction, and it only applies to features that
   * actually have a span.
   */
  const onEntity = parsePointOnEntity(
    anchorName
  );

  if (onEntity !== null) {
    const span = twoPointSpan(object);

    if (!span) {
      return null;
    }

    return lerpPoint(
      span.start,
      span.end,
      onEntity
    );
  }

  const capabilities =
    capabilitiesFor(object.type);

  if (
    typeof capabilities.anchors !==
    "function"
  ) {
    return null;
  }

  try {
    /*
     * A capability's anchors() returns the WHOLE map for the
     * feature, keyed by anchor name - not the single anchor that
     * was asked for. Treating its result as a bare point made every
     * lookup return null, and no dimension could resolve a point
     * from a real feature.
     *
     * Asking each capability for one point instead would mean every
     * capability needed its own lookup as well as its own geometry,
     * and one returning a point rather than a map would silently
     * measure nothing.
     */
    const resolved =
      capabilities.anchors(object);

    if (
      !resolved ||
      typeof resolved !== "object" ||
      !(anchorName in resolved)
    ) {
      return null;
    }

    return normalisePoint(
      resolved[anchorName]
    );
  } catch (error) {
    /*
     * A capability that throws is a bug in that capability, but it
     * must not take the drawing down with it: an unresolvable
     * anchor is a recoverable state.
     */
    return null;
  }
}

function normalisePoint(point) {
  if (
    !point ||
    !Number.isFinite(point.x) ||
    !Number.isFinite(point.y)
  ) {
    return null;
  }

  return { x: point.x, y: point.y };
}

/*
 * The fraction encoded in a point-on-entity anchor, or null.
 *
 * The format is deliberately plain text so it survives a save and a
 * reload without a parser of its own: a reference is written as JSON,
 * and a name like "pointOnEntity@0.5" reads back as the same string.
 */
function parsePointOnEntity(anchorName) {
  if (!anchorName.startsWith("pointOnEntity@")) {
    return null;
  }

  const fraction = Number(
    anchorName.slice("pointOnEntity@".length)
  );

  if (!Number.isFinite(fraction)) {
    return null;
  }

  return Math.min(1, Math.max(0, fraction));
}

/*
 * Every anchor a feature currently exposes.
 *
 * Used to offer the user a choice of what to measure, and to build
 * the anchor list a dimension stores. A feature with no anchors has
 * nothing to dimension, which is a different answer from one that
 * failed.
 */
function anchorsFor(object) {
  const capabilities =
    capabilitiesFor(object?.type);

  if (
    object &&
    typeof capabilities.anchors === "function"
  ) {
    /*
     * Resolved eagerly, because an anchor that does not resolve now
     * cannot be offered as a choice. The dimension keeps the NAME,
     * not the point, so this is only used to show the user what is
     * available.
     */
    const names =
      capabilities.anchorNames
        ? capabilities.anchorNames(object)
        : [];

    return names
      .map((name) => ({
        name,
        point: resolveAnchor(object, name)
      }))
      .filter((entry) => entry.point !== null);
  }

  return [];
}

/*
 * ========================================================
 * GENERIC CAPABILITIES
 * ========================================================
 */

/*
 * A point's position, and the span between two of them.
 *
 * Everything positional in EnggDraw - points, particles, force
 * application points, support locations, truss joints - is a point
 * with a name. Handling them through one table rather than a dozen
 * near-identical cases is what keeps supports, connections and
 * particles dimensionable without the dimension system growing a
 * branch for each.
 */
function pointAnchor(object) {
  const g = object.geometry || {};

  return normalisePoint(
    g.position ||
      g.point ||
      g.origin ||
      g.start ||
      g
  );
}

function twoPointSpan(object) {
  const g = object.geometry || {};

  const start = normalisePoint(g.start);
  const end = normalisePoint(g.end);

  if (!start || !end) {
    return null;
  }

  return { start, end };
}

/*
 * A point a fraction of the way along a span.
 *
 * Derived points (midpoint, quarters) are stated as fractions rather than
 * as stored geometry, so they stay correct when the endpoints move. A
 * stored midpoint would drift out of step with the line it describes.
 */
function lerpPoint(start, end, t) {
  return normalisePoint({
    x: start.x + (end.x - start.x) * t,
    y: start.y + (end.y - start.y) * t,
  });
}

/*
 * How a span should be measured.
 *
 * A horizontal span measured as a diagonal would be a worse
 * dimension than the horizontal distance between the same two
 * points - the vertical difference is already implied by the beam's
 * position, and stating it as part of the length makes the number
 * wrong for the thing the reader is checking.
 *
 * So an exactly-horizontal span is offered as horizontal, an
 * exactly-vertical one as vertical, and anything else as an aligned
 * measurement. That is the same rule the Dimension tool applies to
 * two hand-picked points, so the two paths agree.
 */
function spanDimensionTypes(
  span,
  { allowAngular = false } = {}
) {
  const deltaX = Math.abs(span.end.x - span.start.x);
  const deltaY = Math.abs(span.end.y - span.start.y);

  const tolerance =
    Math.max(
      1e-9,
      Math.hypot(deltaX, deltaY) * 1e-6
    );

  const types = [];

  if (deltaY <= tolerance && deltaX > tolerance) {
    types.push("horizontal");
  } else if (deltaX <= tolerance && deltaY > tolerance) {
    types.push("vertical");
  } else if (deltaX > tolerance || deltaY > tolerance) {
    types.push("aligned");
  }

  /*
   * The direct distance is always available too, but after the
   * axis-aligned reading of the same span - so that a dimensioner's
   * first choice for a horizontal beam is its length rather than
   * its hypotenuse.
   */
  types.push("linear");

  if (allowAngular) {
    types.push("angular");
  }

  return [...new Set(types)];
}

/*
 * ========================================================
 * TYPE REGISTRATIONS
 * ========================================================
 */

/*
 * Positions everything on the drawing can share.
 *
 * Points, particles, truss joints and force application points are
 * all "a place", and all of them are dimensionable the same way:
 * by their coordinates and their distance to another place. They are
 * still distinct feature types - a Particle does not become a
 * Point - and this registration does not change that. It says which
 * measurements apply, which is a statement about measurement, not
 * about what the feature is.
 */
function registerPositional() {
  [
    "point",
    "particle",
    "pin-support",
    "roller-support",
    "fixed-support",
    "smooth-support",
    "pin-connection",
    "fixed-connection",
    "slider-connection",
    "connection"
  ].forEach((type) => {
    register(type, {
      dimensions: [
        "coordinate",
        "horizontal",
        "vertical"
      ],
      anchorNames: () => ["position"],
      anchors: (object) => {
        const point =
          pointAnchor(object);

        return point
          ? { position: point }
          : null;
      }
    });
  });
}

/*
 * Spans: anything with a start and an end.
 *
 * Lines, beams, cables, shafts and the connection types are all
 * defined by two points, and all of them are measured by the same
 * rules - which is why a Beam's span dimension is produced by the
 * same code as a Line's, applied to the Beam's own real endpoints.
 */
function registerSpans() {
  /*
   * Shafts are registered apart from the plain spans.
   *
   * A shaft stores a DIAMETER as one of its own values, and that
   * diameter is the feature's real exterior measurement - not a
   * distance between two points on its centreline, which would state
   * half the true number. Registering shafts as ordinary spans meant
   * that measurement was never offered, and every consumer had to
   * know about the shaft's diameter for itself or would quietly
   * leave it out.
   */
  register("shaft", {
    dimensions: (object) => {
      const span = twoPointSpan(object);
      const geometry = object.geometry || {};

      const candidates = span
        ? spanDimensionTypes(span)
        : ["linear"];

      /*
       * Only where the shaft really stores a diameter. Offering it
       * unconditionally would put a measurement in front of the
       * student for a feature that has none to answer it with.
       */
      const hasDiameter = Number.isFinite(
        Number(geometry.diameter)
      );

      return hasDiameter
        ? [...candidates, "diameter"]
        : candidates;
    },
    anchorNames: () => ["start", "end"],
    anchors: (object) => {
      const span = twoPointSpan(object);

      return span
        ? { start: span.start, end: span.end }
        : null;
    },
  });

  ["line", "beam", "cable", "force", "resultant", "force-components"].forEach(
    (type) => {
      register(type, {
        dimensions: (object) => {
          const span = twoPointSpan(object);

          return span
            ? spanDimensionTypes(span)
            : ["linear"];
        },
        /*
         * Midpoint and quarter points are anchors in their own right.
         *
         * Without them a "point to midpoint" reference has no NAME to store:
         * the snap layer publishes a midpoint fine, but a line only declared
         * `start` and `end`, so the reference could not be resolved and the
         * dimension had to refuse. Declaring them here lets the reference
         * persist and survive parent transforms, which is what the same
         * points get when they are the line's own ends.
         */
        anchorNames: () => ["start", "end", "midpoint", "quarter1", "quarter3"],
        anchors: (object) => {
          const span = twoPointSpan(object);

          if (!span) {
            return null;
          }

          return {
            start: span.start,
            end: span.end,
            midpoint: lerpPoint(span.start, span.end, 0.5),
            quarter1: lerpPoint(span.start, span.end, 0.25),
            quarter3: lerpPoint(span.start, span.end, 0.75),
          };
        },
      });
    }
  );
}

/*
 * Circular features.
 *
 * A Circle is its radius and its centre. An Arc is those plus the
 * length of the sweep, which is the one measurement unique to it -
 * and it is offered after the radius because a radius is what a
 * reader checks first.
 */
function registerCircular() {
  register("circle", {
    /*
     * Diameter leads. A circle's size is nearly always quoted by
     * its diameter, and leading with it means Smart Dimension
     * produces the conventional figure rather than the other one.
     */
    dimensions: ["diameter", "radius", "coordinate"],
    anchorNames: (object) => [
      "center",
      "east",
      "west",
      "north",
      "south"
    ],
    anchors: (object) => {
      const g = object.geometry || {};

      const center = normalisePoint(g.center);

      if (!center) {
        return null;
      }

      const radius = Number(g.radius);

      if (!Number.isFinite(radius)) {
        return { center };
      }

      return {
        center,
        east: { x: center.x + radius, y: center.y },
        west: { x: center.x - radius, y: center.y },
        north: { x: center.x, y: center.y + radius },
        south: { x: center.x, y: center.y - radius }
      };
    }
  });

  register("arc", {
    dimensions: [
      "radius",
      "arc-length",
      "diameter",
      "angular"
    ],
    anchorNames: () => [
      "center",
      "start",
      "end"
    ],
    anchors: (object) => {
      const g = object.geometry || {};

      const center = normalisePoint(g.center);
      const radius = Number(g.radius);

      const startAngle = Number(g.startAngle);
      const endAngle = Number(g.endAngle);

      if (
        !center ||
        !Number.isFinite(radius) ||
        !Number.isFinite(startAngle) ||
        !Number.isFinite(endAngle)
      ) {
        return null;
      }

      return {
        center,
        start: {
          x: center.x + radius * Math.cos(startAngle),
          y: center.y + radius * Math.sin(startAngle)
        },
        end: {
          x: center.x + radius * Math.cos(endAngle),
          y: center.y + radius * Math.sin(endAngle)
        }
      };
    }
  });
}

/*
 * Rectangle-like bodies.
 *
 * Width and height are measured along the body's OWN axes, not the
 * world's. A rectangle rotated 30 degrees is still 80 wide and 40
 * high in its own frame, and measuring it horizontally would give a
 * number that describes neither its width nor anything the reader
 * could use.
 */
function registerRectangles() {
  ["rectangle", "rigid-body"].forEach(
    (type) => {
      register(type, {
        dimensions: (object) =>
          isCircularBody(object)
            ? ["diameter", "radius", "coordinate"]
            : [
                  "horizontal",
                  "vertical",
                  "aligned",
                  "angular",
                  "coordinate"
                ],
        anchorNames: (object) =>
          isCircularBody(object)
            ? ["center"]
            : [
                  "topLeft",
                  "topRight",
                  "bottomRight",
                  "bottomLeft",
                  "center",

                  /*
                   * AND EACH EDGE AS A SEGMENT.
                   *
                   * A rectangle is one authoritative feature - it is not
                   * decomposed into four Line features - but its four edges
                   * are real straight references, so selecting one behaves
                   * like selecting a line: it dimensions that edge's length,
                   * and two edges can give an angle where they meet.
                   *
                   * The corners remain valid snap references throughout; the
                   * segments are an addition, not a replacement.
                   */
                  ...segmentAnchorNames(
                    rectangleEdgePoints(object)
                  )
                ],
        anchors: (object) => {
          const g = object.geometry || {};

          if (isCircularBody(object)) {
            const center =
              enggFeatureGeometry
                  ?.rigidBodyCenter?.(g) ||
              normalisePoint(g.position);

            return center
              ? { center }
              : null;
          }

          const corners =
            enggFeatureGeometry
              ?.rectangleCorners?.(g) || [];

          const named = [
            "topLeft",
            "topRight",
            "bottomRight",
            "bottomLeft"
          ];

          const resolved = {};

          corners.forEach(
            (corner, index) => {
              const point =
                normalisePoint(corner);

              if (point && named[index]) {
                resolved[named[index]] =
                  point;
              }
            }
          );

          const center =
            corners
              .map(normalisePoint)
              .filter(Boolean)
              .reduce(
                (accumulator, point) => ({
                  x: accumulator.x + point.x / 4,
                  y: accumulator.y + point.y / 4
                }),
                { x: 0, y: 0 }
              );

          if (corners.length) {
            resolved.center = center;
          }

          /*
           * The edges, as segments. Added after the corners so the named
           * corners keep their names and only the segment points are new.
           */
          Object.assign(
            resolved,
            segmentAnchors(
              rectangleEdgePoints(object)
            ) || {}
          );

          return Object.keys(resolved).length
            ? resolved
            : null;
        }
      });
    }
  );
}

function isCircularBody(object) {
  const g = object?.geometry || {};

  return (
    (object.type === "rigid-body" &&
      enggFeatureGeometry
        ?.rigidBodyShape?.(g) ===
        "circle") ||
    Number.isFinite(Number(g.diameter)) &&
      !Number.isFinite(Number(g.width))
  );
}

/*
 * Polygonal geometry.
 *
 * A polygon is many sides and many angles, and offering all of them
 * at once would be clutter. Only its overall extent is offered here;
 * an individual side is dimensioned by selecting that side's two
 * vertices, which is the existing two-point workflow and needs no
 * separate mechanism.
 */
function registerPolygons() {
  register("polygon", {
    /*
     * NOT a diameter.
     *
     * A polygon has vertices, not a circle. Listing one here made
     * Smart Dimension offer a measurement whose only possible referents
     * were two arbitrary vertices - a chord, described as a diameter.
     * Side lengths and angles are what a polygon can actually state.
     */
    dimensions: [
      "horizontal",
      "vertical",
      "coordinate"
    ],
  
    anchorNames: (object) => {
      const vertices =
        polygonVertices(object);

      return [
        "extent",
        ...vertices
          .map(
            (_, index) => `vertex${index}`
          )
      ];
    },
    anchors: (object) => {
      const vertices =
        polygonVertices(object);

      const resolved = { extent: null };

      vertices.forEach((point, index) => {
        resolved[`vertex${index}`] =
          normalisePoint(point);
      });

      return resolved;
    }
  });

  register("polyline", {
    dimensions: [
      "horizontal",
      "vertical",
      "coordinate"
    ],
    /*
     * EACH SEGMENT IS A REFERENCE IN ITS OWN RIGHT.
     *
     * A polyline is not one straight body - it is a chain of them - so the
     * only honest linear references are its individual segments. The whole
     * polyline's first-to-last span is deliberately NOT offered as a length:
     * a student who clicked a segment meant that segment, and a dimension
     * across the whole chain would state the distance between two points that
     * are not the ones they picked.
     *
     * Every segment publishes its two ends and its midpoint, so an endpoint,
     * a midpoint and a point-on-segment are all available to the snap system
     * and to a dimension - which is what §15 of the specification asks for.
     */
    anchorNames: (object) =>
      segmentAnchorNames(polylinePoints(object)),
    anchors: (object) =>
      segmentAnchors(polylinePoints(object))
  });

  register("triangle", {
    /*
     * NOT a diameter, for the same reason as a polygon: its three
     * points describe a triangle, and the only "diameter" on offer
     * would have been a chord between two of them.
     */
    dimensions: [
      "horizontal",
      "vertical",
      "coordinate"
    ],
    /*
     * THE THREE VERTICES AND THE THREE EDGES.
     *
     * A triangle is ONE feature, but it has three measurable sides, and a
     * student dimensioning a triangle means a SIDE - not the whole shape.
     * Publishing each edge as its own named segment is what lets a click
     * near one side resolve to that side, and what makes the reference
     * PERSISTENT: the anchors are re-derived from the triangle's current
     * points every time, so the dimension keeps measuring the same side
     * after the triangle is edited.
     *
     * The edges are named `segment0..2Start/End/Mid` - the same vocabulary
     * a polyline and a rectangle publish - so the existing segment hit
     * test, the existing reference resolution and the existing drawing all
     * work on a triangle without a triangle-specific rule.
     *
     * The loop CLOSES (C back to A), so all three sides are present. Without
     * the closure a triangle would expose only AB and BC, and the side a
     * student clicked could be the missing one.
     */
    /*
     * Three edges, so three segments: `segment0Start/End/Mid` through
     * `segment2Start/End/Mid`. Named from a closed three-point chain, which
     * is the same shape the anchors resolve from, so the names and the
     * points cannot disagree about how many sides a triangle has.
     */
    anchorNames: () => [
      "a",
      "b",
      "c",
      ...segmentAnchorNames([0, 1, 2, 0])
    ],
    anchors: (object) => {
      const points =
        (object.geometry?.points || [])
          .map(normalisePoint)
          .filter(Boolean);

      if (points.length < 3) {
        return null;
      }

      return {
        a: points[0],
        b: points[1],
        c: points[2],
        ...segmentAnchors(triangleEdgePoints(object))
      };
    }
  });
}

function polygonVertices(object) {
  const g = object?.geometry || {};

  try {
    return (
      enggDrawingState
        .polygonVertices(g) || []
    )
      .map(normalisePoint)
      .filter(Boolean);
  } catch (error) {
    return [];
  }
}

/*
 * ========================================================
 * SEGMENTS OF A COMPOSITE FEATURE
 * ========================================================
 *
 * A polyline is a chain of straight segments and a rectangle is four of them.
 * Neither is decomposed into Line features - the composite stays one
 * authoritative feature - but each of its segments is a real straight
 * reference, and Smart Dimension has to be able to take one.
 *
 * So each segment publishes three named anchors, derived from the feature's
 * current points every time:
 *
 *     segment{i}Start   segment{i}End   segment{i}Mid
 *
 * A dimension that references `segment2Start` follows the polyline when it
 * moves, because the anchor is resolved from the live geometry rather than
 * being a stored coordinate. Naming a segment this way is what lets one
 * segment be dimensioned without dimensioning the whole chain.
 */

function polylinePoints(object) {
  return (object?.geometry?.points || [])
    .map(normalisePoint)
    .filter(Boolean);
}

/*
 * A rectangle's four corners, CLOSED - the last point repeats the first, so
 * the four edges are between consecutive points and the fourth returns to the
 * start. Without the closure a rectangle would expose only three of its four
 * edges, and the edge a student happened to click could be the missing one.
 */
function rectangleEdgePoints(object) {
  const corners =
    enggFeatureGeometry?.rectangleCorners?.(
      object?.geometry || {}
    ) || [];

  const points = corners.map(normalisePoint).filter(Boolean);

  if (points.length >= 3) {
    points.push({ ...points[0] });
  }

  return points;
}

/*
 * A TRIANGLE'S THREE EDGES, AS A CLOSED CHAIN OF POINTS.
 *
 * The three vertices in order, then the first repeated - so the chain runs
 * A to B, B to C, C back to A. A triangle is a closed shape and all three of
 * its sides are real, so the fourth point is what gives the third side
 * somewhere to end.
 *
 * The ORDER IS THE SHAPE'S, not a preference: `segment0` is the edge between
 * the first two stored points, and which edge a student means is decided by
 * where they clicked (see the segment hit test), never by position in this
 * list.
 */
function triangleEdgePoints(object) {
  const points = (object?.geometry?.points || [])
    .map(normalisePoint)
    .filter(Boolean);

  if (points.length < 3) {
    return [];
  }

  return [points[0], points[1], points[2], { ...points[0] }];
}

function segmentAnchorNames(points) {
  if (!points || points.length < 2) {
    return [];
  }

  const names = [];

  for (let index = 0; index < points.length - 1; index += 1) {
    names.push(`segment${index}Start`);
    names.push(`segment${index}End`);
    names.push(`segment${index}Mid`);
  }

  return names;
}

function segmentAnchors(points) {
  if (!points || points.length < 2) {
    return null;
  }

  const resolved = {};

  for (let index = 0; index < points.length - 1; index += 1) {
    resolved[`segment${index}Start`] = points[index];
    resolved[`segment${index}End`] = points[index + 1];
    resolved[`segment${index}Mid`] = lerpPoint(
      points[index],
      points[index + 1],
      0.5
    );
  }

  return resolved;
}

/*
 * Loads.
 *
 * The span a load covers is a real geometric quantity and is
 * dimensionable. Its INTENSITY is not - it is an annotation, and it
 * is handled by the annotation system, never here. Keeping the two
 * apart is the distinction the whole system turns on: this module
 * answers "how long is this", and it has no opinion about how much
 * force is on it.
 */
function registerLoads() {
  ["load", "varying-load"].forEach((type) => {
    register(type, {
      dimensions: (object) => {
        const span = twoPointSpan(object);

        return span
          ? spanDimensionTypes(span, {
                allowAngular: false
              })
          : ["linear"];
      },
      anchorNames: () => ["start", "end"],
      anchors: (object) => {
        const span = twoPointSpan(object);

        return span
          ? { start: span.start, end: span.end }
          : null;
      },
    });
  });
}

/*
 * The fallback.
 *
 * Anything not registered above is still a point or a span or a
 * circle as far as measurement is concerned, because that is what
 * nearly everything in a drawing reduces to. Registering the
 * generic case means an unrecognised future feature is still
 * dimensionable rather than silently excluded.
 */
/*
 * What an unregistered feature can be measured from.
 *
 * A feature type nobody has written support for is still a real
 * piece of geometry, and refusing to measure it would mean the
 * system silently excluding things rather than handling them. So
 * the generic case looks for the two shapes almost everything
 * reduces to - a span with two ends, and a point at a location -
 * and offers whichever it finds.
 */
function genericAnchors(object) {
  const span = twoPointSpan(object);

  if (span) {
    return { start: span.start, end: span.end };
  }

  const centre =
    normalisePoint(object?.geometry?.center);

  if (centre) {
    return { position: centre, center: centre };
  }

  const point =
    pointAnchor(object) ||
    normalisePoint(object?.geometry?.start);

  return point ? { position: point } : null;
}

function genericAnchorNames(object) {
  const resolved = genericAnchors(object);

  return resolved ? Object.keys(resolved) : [];
}

function registerGeneric() {
  register("__generic__", {
    dimensions: [
      "coordinate",
      "linear",
      "horizontal",
      "vertical"
    ],
    anchorNames: (object) =>
      genericAnchorNames(object),
    anchors: (object) =>
      genericAnchors(object)
  });
}

registerPositional();
registerCircular();
registerRectangles();
registerPolygons();
registerLoads();
registerGeneric();

/*
 * Spans last, because its lazy candidate resolution reads the
 * registry that the earlier registrations build up.
 */
registerSpans();

/*
 * ========================================================
 * PUBLIC API
 * ========================================================
 */

/*
 * Everything a feature type can be dimensioned as, in preference
 * order.
 *
 * Never an empty list for a feature that has anchors: a feature
 * with somewhere to measure is always dimensionable in at least one
 * way.
 */
function dimensionCandidates(object) {
  const capabilities =
    capabilitiesFor(object?.type);

  const declared =
    typeof capabilities.dimensions ===
      "function"
      ? capabilities.dimensions(object)
      : capabilities.dimensions;

  const candidates = (
    Array.isArray(declared)
      ? declared
      : []
  ).filter(
    (type) => DIMENSION_TYPES[type]
  );

  if (candidates.length) {
    return candidates;
  }

  /*
   * Nothing declared, so fall back to measuring between the
   * feature's own anchors - which is what a point or a span can
   * always do.
   */
  const anchors = anchorsFor(object);

  return anchors.length >= 2
    ? ["linear"]
    : ["coordinate"];
}

/*
 * The named anchors a dimension may refer to.
 */
function anchorOptions(object) {
  return anchorsFor(object).map(
    (entry) => entry.name
  );
}

/*
 * Whether an anchor still resolves.
 *
 * The test for whether a dimension is still meaningful. A dimension
 * whose anchor has stopped resolving is marked unresolved rather
 * than continuing to display the last number it knew.
 */
function anchorResolves(
  object,
  anchorName
) {
  return (
    resolveAnchor(object, anchorName) !== null
  );
}

/*
 * The candidates two features offer BETWEEN them.
 *
 * Kept here rather than in the smart-dimension tool because it is a
 * statement about the features' geometry, not about what the user
 * asked for.
 */
function pairCandidates(
  first,
  second
) {
  const a = resolveAnchor(first, "position");
  const b = resolveAnchor(second, "position");

  if (a && b) {
    const deltaX = Math.abs(b.x - a.x);
    const deltaY = Math.abs(b.y - a.y);

    const types = [];

    if (deltaX > 1e-9 && deltaY > 1e-9) {
      types.push("linear");
    } else if (deltaY <= 1e-9) {
      types.push("horizontal", "linear");
    } else if (deltaX <= 1e-9) {
      types.push("vertical", "linear");
    } else {
      types.push("linear");
    }

    return types;
  }

  /*
   * Two spans that are not axis-aligned can be measured between
   * their nearest ends, and the included angle between them is
   * often what the reader actually wants.
   */
  const spanA = twoPointSpan(first);
  const spanB = twoPointSpan(second);

  /*
   * Two spans are measured by the distance between them, NOT by the
   * angle between them.
   *
   * An included angle needs two directions that actually enclose
   * one, and this function has nothing to decide whether they do.
   * Offering it here meant two parallel lines came back as a 0
   * degree dimension - true of them, useless to them, and
   * indistinguishable at the placement step from a real
   * measurement.
   *
   * Where an angle IS meaningful between two spans, the caller that
   * has the geometry to judge it makes that judgement. This one
   * answers the distance.
   */
  if (spanA && spanB) {
    /*
     * The separation between them leads.
     *
     * For two parallel spans an axis-aligned reading IS the gap
     * between them, and it is a measurement of where they sit
     * relative to each other - rather than a restatement of their
     * own lengths, which is what the direct distance between one
     * span's start and the other's end gives. A student selecting
     * two parallel lines wants to know how far apart they are, and
     * "linear" would have told them the length instead.
     */
    /*
     * Equal in one axis means the separation lies in the other.
     *
     * Two spans at the same height are separated HORIZONTALLY; two
     * spans side by side are separated VERTICALLY. Stated that way
     * round it is one rule rather than two cases, and it is the
     * rule a reader means by "how far apart are these".
     */
    const separation =
      Math.abs(spanA.start.y - spanB.start.y) < 1e-9
        ? "horizontal"
        : Math.abs(spanA.start.x - spanB.start.x) < 1e-9
          ? "vertical"
          : null;

    return separation
      ? [separation, "linear"]
      : ["linear"];
  }

  return ["linear"];
}

/*
   * ========================================================
   * WHICH ANCHOR IS THIS POINT?
   * ========================================================
   *
   * The bridge between a snap and a dimension reference.
   *
   * A snap says what KIND of point it hit - `endpoint`, `midpoint`,
   * `center`, `quarter-1`. A dimension reference says which anchor NAME of
   * which feature - `start`, `end`, `center`. Those are different
   * vocabularies and nothing converted between them, so a click on a real
   * endpoint had no name to store and could not become a reference at all.
   *
   * The kind alone is not enough to choose the name, either: `endpoint`
   * matches BOTH ends of a line, and only one of them is the point the
   * cursor was actually over. So the kind is used as a filter and the
   * position decides within it - the anchor nearest the clicked point is
   * the one that was meant.
   *
   * That is the same nearest-anchor rule the point-on-entity snapping
   * already applies when it publishes a candidate, so the reference that
   * gets stored is the point the student saw snap.
   *
   * Returns null when nothing matches, which the caller turns into a clear
   * message rather than a dimension against an arbitrary anchor.
   */
  function anchorNameAtPoint(
    object,
    point,
    kind = null
  ) {
    const anchors = anchorsFor(object);

    if (!anchors.length) {
      return null;
    }

    const target = normalisePoint(point);

    if (!target) {
      return null;
    }

    /*
     * A KIND WE RECOGNISE BUT CANNOT SATISFY IS A REAL "NO".
     *
     * Falling back to the nearest anchor of any kind here was worse than
     * useless: a midpoint snap on a line publishes no midpoint anchor, so the
     * nearest one won - and it returned `start`, silently turning
     * `endpoint to midpoint` into `endpoint to endpoint` again, which is the
     * exact fault this conversion exists to fix. The dimension would have
     * been created, looked right, and measured the wrong distance.
     *
     * So a kind we understand and cannot match returns null, and the caller
     * says so. Refusing is visible; measuring the wrong thing is not.
     *
     * A kind we do NOT understand - a future snap type, say - still falls
     * back, because we have no basis to claim it cannot be satisfied.
     */
    const known =
      kind === "endpoint" ||
      kind === "center" ||
      kind === "centre" ||
      kind === "midpoint" ||
      kind === "middle";

    /*
     * A FEATURE WITH ONE ANCHOR IS THAT ANCHOR.
     *
     * A particle has a single point called `position`; so do a moment and a
     * support. Snapping to any kind of point on one of them lands on the same
     * place, because there is nowhere else to land - so the kind is not a
     * filter here. Without this, every one of those features refused every
     * snap kind, and could not be dimensioned by clicking it at all.
     */
    const sole =
      anchors.length === 1
        ? anchors
        : null;

    const named =
      sole ||
      (kind
        ? anchors.filter((entry) =>
            anchorKindMatches(entry.name, kind)
          )
        : []);

    if (kind && known && !named.length) {
      return null;
    }

    const pool = named.length
      ? named
      : anchors;

    let best = null;
    let bestDistance = Infinity;

    for (const entry of pool) {
      const candidate = normalisePoint(entry.point);

      if (!candidate) {
        continue;
      }

      const distance =
        Math.hypot(
          candidate.x - target.x,
          candidate.y - target.y
        );

      if (distance < bestDistance) {
        bestDistance = distance;
        best = entry.name;
      }
    }

    return best;
  }

  /*
   * Does an anchor NAME answer to this snap KIND?
   *
   * The two vocabularies only partly overlap, so this is a deliberate
   * mapping rather than a string compare: `east`/`west` are endpoints of a
   * rectangle in this system's vocabulary, and `centre` and `center` are
   * the same word spelled both ways.
   */
  function anchorKindMatches(name, kind) {
    const n = String(name || "").toLowerCase();
    const k = String(kind || "").toLowerCase();

    if (k === "endpoint") {
      return ["start", "end", "east", "west", "a", "b"].includes(n);
    }

    if (k === "center" || k === "centre") {
      return n === "center" || n === "centre";
    }

    if (k === "midpoint" || k === "middle") {
      return n === "midpoint" || n === "middle";
    }

    return n === k;
  }

  const enggMeasurement = {
    anchorKindMatches,
    anchorNameAtPoint,
    DIMENSION_TYPES,
  anchorOptions,
  anchorResolves,
  anchorsFor,
  capabilitiesFor,
  dimensionCandidates,
  isAngular,
  known,
  normalisePoint,
  pairCandidates,
  register,
  resolveAnchor,
  spanDimensionTypes,
  twoPointSpan
};

export default enggMeasurement;

import {
  dimensionArrowMm,
  dimensionLabelSize,
  dimensionPenMm,
  DIMENSION_DEFAULT_FONT_PT,
} from "../../../../shared/geometry/dimension-layout.js";
/*
 * The Dimension object.
 *
 * A dimension is a MEASUREMENT OF GEOMETRY, and this module is the
 * whole of what that means. It deliberately knows nothing about
 * engineering values: a force's magnitude is an annotation, and no
 * code in here can produce one. That separation is the distinction the
 * entire system turns on - geometry is what a dimension measures,
 * engineering meaning is what an annotation states - and keeping the
 * two in separate modules is what makes it a rule rather than a
 * convention.
 *
 * WHY A DIMENSION STORES REFERENCES AND NOT A NUMBER
 * -------------------------------------------------
 * The obvious implementation stores the measured value: the user
 * dimensions a 100 line, "100" is saved, and the drawing shows 100.
 * It is smaller, simpler, and wrong. The moment the line moves the
 * dimension still says 100, and nothing in the file records that the
 * number used to mean something about that line.
 *
 * So a dimension stores WHERE it measured - which feature, and which
 * named part of it - and recalculates every time it is drawn. Moving
 * the line changes the measurement because the measurement was never
 * stored in the first place. Association is not a mechanism kept
 * up to date; it is the absence of a cached value.
 *
 * WHAT A REFERENCE IS
 * ------------------
 *     { featureId, anchor, part? }
 *
 * A one-point reference (a radius, a coordinate) names one anchor. A
 * two-point reference (a length, an angle) names two. `part` exists
 * for measurements taken from a feature's own dimensions rather than
 * its anchors - a shaft's diameter, a circle's radius - so that
 * changing the shaft's diameter changes the dimension that states it.
 *
 * THE VALUE IS NEVER TYPED IN
 * ---------------------------
 * There is no way to set a dimension's value from this module, and
 * that is deliberate. A dimension states what the geometry is. If a
 * student typed "50 mm" onto a 100 mm line, the drawing would then
 * contain a claim that is false and nothing to show it is false.
 * A dimension is an annotation: it reports the drawing's own size and
 * never resizes what it measures.
 *
 * UNRESOLVED, NOT STALE
 * ---------------------
 * When a source feature is deleted, its anchor can no longer resolve.
 * The dimension is marked unresolved and says so, rather than
 * continuing to display the last number it knew. A stale number on a
 * drawing is worse than an obvious gap: it looks like an answer.
 */
import enggMeasurement from "../../../../shared/geometry/measurement-core.js";
import enggQuantities from "../../../../shared/units/quantities.js";

/*
 * The reference kinds.
 *
 * Named so the model, the renderer, the file and the tests all say
 * the same thing about what a measurement is taken from. A
 * measurement is either between two places, about one place, or
 * about one of a feature's own values.
 */
const REFERENCE_KINDS = {
  between: "between",
  at: "at",
  property: "property"
};

/*
 * How a dimension's measurement is presented.
 *
 * Named rather than inferred from the type, because the same
 * measurement can be drawn two ways and the choice belongs to the
 * user: a 100 mm beam can carry its length horizontally, vertically,
 * or along itself, and all three are the same number.
 */
const ORIENTATIONS = {
  auto: "auto",
  horizontal: "horizontal",
  vertical: "vertical",
  aligned: "aligned"
};

const DEFAULT_PRECISION = 2;

/*
 * The stand-off and overshoot of a witness line, in drawing units (mm).
 *
 * Chosen as physical drafting sizes rather than screen sizes: 1.5 mm clear of
 * the geometry and 2 mm past the dimension line is what a hand-drawn dimension
 * does, and it is large enough to stay legible in a printed figure. They are
 * declared HERE, above every consumer, because a `const` is not hoisted and a
 * value read before its declaration is a load-time error.
 */
export const WITNESS_STANDOFF_MM = 1.5;
export const WITNESS_OVERSHOOT_MM = 2;

/*
 * ========================================================
 * CREATION
 * ========================================================
 */

/*
 * A fresh identity.
 *
 * Prefixed by kind so that an id in a saved file is recognisable as
 * a dimension without looking anything up, and random rather than
 * sequential so that the number never implies an order. A dimension
 * that could be reordered by deleting another one would be a
 * surprising thing for a file to be able to do.
 */
function newDimensionId() {
  const random =
    typeof globalThis.crypto === "object" &&
    globalThis.crypto &&
    typeof globalThis.crypto.randomUUID === "function"
      ? globalThis.crypto.randomUUID().replace(/-/g, "")
      : Math.random().toString(16).slice(2);

  return `dimension-${random.slice(0, 8)}`;
}

/*
 * Build a Dimension.
 *
 *   type       which measurement, from the measurement core
 *   refs       one or two references, as above
 *   placement  where the dimension sits, in drawing units
 *   orientation how it is drawn; "auto" follows the measurement
 *   style     overrides from the document defaults
 *
 * The value is NOT a parameter. There is deliberately no way to
 * create a dimension that states a number rather than measuring
 * one.
 */
function createDimension({
  dimensionType,
  refs,
  placement,
  orientation = ORIENTATIONS.auto,
  style = {},
  label = null,
  dimensionKind = "smart",
  mode = "driven",
  content = "",
  drivingValue = null,
  name,
} = {}) {
  if (dimensionKind === "variable" && !String(content ?? "").trim()) {
    throw new Error("Variable dimension content is required.");
  }
  const normalisedRefs = normaliseReferences(refs);

  const textStyle = {
    fontSize: DIMENSION_DEFAULT_FONT_PT,
    textAlign: "center",
    bold: false,
    italic: false,
    ...style,
  };

  const fontSize = Number(textStyle.fontSize) > 0 ? Number(textStyle.fontSize) : DIMENSION_DEFAULT_FONT_PT;

  return {
    id: newDimensionId(),
    name: name || dimensionLabel(dimensionType),
    type: "dimension",

    /*
     * The measurement this dimension states. Kept as a plain string
     * so a saved file reads clearly and so a renderer can switch on
     * it without loading the capability layer.
     */
    dimensionType,

    /*
     * Where the measurement is taken FROM. This is the whole of the
     * association, and it is the only reason the dimension can
     * update when the geometry does.
     */
    sourceRefs: normalisedRefs,

    /*
     * An override the user may type, such as "FIELD" on a
     * fabricated dimension. It never replaces the measurement: it
     * is shown alongside it, and the measurement is still what the
     * dimension asserts.
     */
    label,
    dimensionKind: dimensionKind === "variable" ? "variable" : "smart",
    mode: mode === "driving" && dimensionKind !== "variable" ? "driving" : "driven",
    content: String(content ?? "").trim(),
    drivingValue,

    /*
     * Where the dimension is DRAWN, in drawing units - deliberately
     * separate from what it measures, so moving a dimension cannot
     * move the geometry it describes.
     */
    placement: {
      x: Number(placement?.x) || 0,
      y: Number(placement?.y) || 0,
    },

    orientation,

    style: {
      /*
       * UNITS ARE NOT OPTIONAL AND WERE NEVER A DISPLAY PREFERENCE.
       *
       * The flag is kept only so a drawing saved with it reads back
       * unchanged; it no longer decides anything. `formatMeasurement`
       * writes the unit unconditionally, because a bare number is
       * ambiguous with every other quantity of the same size on the sheet.
       */
      showUnits: true,
      precision: null,

      /*
       * THE LABEL'S TYPE IS A DOCUMENT PROPERTY, STATED HERE.
       *
       * `fontSize` is in POINTS - the number the Features panel, the
       * quick-access control and the exported `\fontsize` all quote - and it
       * defaults to the readable 11 pt rather than being left absent for three
       * consumers to answer differently. `textAlign`, `bold`, `italic` and the
       * differential `offsetX`/`offsetY` (in drawing units) belong to the label
       * as well; they never touch the measurement, the defining points or the
       * dimension line's placement.
       */
      ...textStyle,
      fontSize,
    },

    /*
     * THE LABEL'S TYPE, AS THE OBJECT'S OWN PROPERTIES TOO.
     *
     * `style` is where the document keeps appearance and is what the panel, the
     * quick-access control and the source read. `fontSize` beside it is the
     * object's OWN statement of its type, so a consumer that has the object but
     * not its style still has the size - and the two are kept equal below, so
     * there is never a second, conflicting value.
     */
    fontSize,

    /*
     * True until a reference stops resolving. Not a flag the user
     * sets: it is the state of the measurement, recomputed from the
     * geometry rather than remembered, so it cannot disagree with
     * the drawing.
     */
    resolved: true,
  };
}

function dimensionLabel(dimensionType) {
  return (
    enggMeasurement?.DIMENSION_TYPES?.[
      dimensionType
    ]?.label || "Dimension"
  );
}

/*
 * References in one shape.
 *
 * Normalised once, at creation, so that every consumer - the
 * recalculation, the renderer, the file, the redundancy check -
 * reads the same fields and none of them has to defend against a
 * half-built reference.
 */
/*
 * ========================================================
 * A REFERENCE KEEPS BOTH OF ITS ENDS
 * ========================================================
 *
 * A reference may name a WHOLE feature (a Line, a Beam) or ONE EDGE of a
 * multi-edge one - `segment1Start` / `segment1End` for a triangle's second
 * side. In the second case BOTH anchors are the reference: they are what say
 * which edge, and dropping `endAnchor` left the dimension unable to resolve a
 * span at all.
 *
 * THAT WAS THE WHOLE OF THE ANGLE DEFECT. A dimension between two edges of
 * one triangle stored only the two `Start` anchors, so nothing could work out
 * the second end of either edge; the measurement fell back to the FEATURE's
 * span - which a triangle does not have - and returned nothing.
 *
 * An ABSENT `endAnchor` stays absent, so a whole-feature reference is
 * unchanged and a point reference does not gain a second end it never had.
 */
function normaliseReferences(refs) {
  const list = Array.isArray(refs) ? refs : [refs];

  return list
    .filter((reference) => reference?.featureId || (reference?.kind === "canvas-point" && Number.isFinite(reference.point?.x) && Number.isFinite(reference.point?.y)))
    .map((reference) => {
      if (reference.kind === "canvas-point") return {kind:"canvas-point", point:{...reference.point}};
      if (reference.kind === REFERENCE_KINDS.property) {
        return {
          kind: REFERENCE_KINDS.property,
          featureId: reference.featureId,
          property: String(reference.property || ""),
        };
      }

      const normalised = {
        kind:
          reference.kind || REFERENCE_KINDS.between,
        featureId: reference.featureId,
        anchor: String(reference.anchor || ""),
      };

      /*
       * THE SECOND END, when the reference names one. A segment reference
       * carries it; a whole-feature or point reference does not.
       */
      if (
        reference.endAnchor !== undefined &&
        reference.endAnchor !== null &&
        reference.endAnchor !== ""
      ) {
        normalised.endAnchor = String(reference.endAnchor);
      }

      return normalised;
    });
}

/*
 * ========================================================
 * MEASUREMENT
 * ========================================================
 */

/*
 * The points a dimension measures between, in drawing units.
 *
 * Resolved now, from the features' current geometry, rather than
 * from anything stored on the dimension. This is the function that
 * makes the association real: it is called every time the dimension
 * is drawn, so geometry that has moved is measured at where it is
 * now.
 *
 * Returns null when a reference cannot be resolved, which is what
 * makes a dimension over deleted geometry detectable rather than
 * merely wrong.
 */
function measurePoints(
  dimension,
  state
) {
  const references = dimension?.sourceRefs || [];

  if (!references.length) {
    return null;
  }

  const points = references.map((reference) =>
    resolveReferencePoint(reference, state)
  );

  /*
   * A PROPERTY REFERENCE IS DRAWN FROM THE FEATURE'S OWN EXTENT.
   *
   * A shaft states its diameter as a value, so its measurement has no

   * two anchors to sit between - there is no pair of points on the

   * centreline that is the diameter. The VALUE was always available

   * (measureProperty reads it), but the geometry to draw it across was

   * not, so graphicsFor produced nothing and the dimension rendered as

   * a bare number with no line.

   *
   * The two points are therefore placed on the feature's own extent at its

   * own radius - which is where they physically are. A diameter runs

   * across the shaft, a radius from its centreline to its surface, and

   * both are drawn on the real body rather than floating beside it.

   */
  const propertyPoint = propertyReferencePoints(
    references[0],
    state
  );

  if (propertyPoint && propertyPoint.length) {
    return propertyPoint;
  }

  /*
   * A POINT-TO-LINE MEASUREMENT IS DRAWN ALONG THE PERPENDICULAR.
   *
   * Its three references name the point and the line's two ends, but a
   * dimension line drawn between the point and an END would show the
   * distance to that end rather than the distance to the line - which is
   * the wrong number and the wrong picture at once.
   *
   * So the second drawn point is the FOOT of the perpendicular: the
   * closest place on the line to the point. That makes the drawn line the
   * perpendicular itself, so the drawing and the stated value agree by
   * construction.
   */
  if (dimension?.dimensionType === "point-line") {
    const perpendicular = perpendicularFoot(
      references,
      state
    );

    if (perpendicular) {
      return perpendicular;
    }

    return null;
  }

  if (points.some((point) => point === null)) {
    return null;
  }

  /*
   * A COORDINATE MEASUREMENT RUNS FROM THE ORIGIN.
   *
   * A coordinate names ONE place - a point's position - but every
   * measurement here is a distance between TWO of them, so a lone
   * point left measurePoints as a one-element array and the very next
   * step read a second point out of it.
   *
   * The missing half is the world origin, which is what a coordinate is
   * measured from anyway: X and Y state a position relative to it. So a
   * single-point measurement is completed from the origin rather than
   * being left half-formed.
   */
  if (points.length === 1) {
    return [{ x: 0, y: 0 }, points[0]];
  }
  return points;
}
/*
 * The point and the foot of its perpendicular onto a line.
 *
 * The line is given by the SECOND and THIRD references, kept as two ends so
 * the foot is recomputed from the line's current position every time. The
 * foot is the projection of the point onto the line's infinite direction,
 * which is what an engineering perpendicular distance is measured to - the
 * closest point on the line, whether or not it falls between the drawn ends.
 *
 * Null when the three references cannot be resolved, or when the line is
 * degenerate - a line of no length has no direction to be perpendicular to,
 * and inventing one would state a distance to nothing.
 */
function perpendicularFoot(references, state) {
  if (!references || references.length < 3) {
    return null;
  }

  const point = resolveReferencePoint(references[0], state);
  const lineStart = resolveReferencePoint(references[1], state);
  const lineEnd = resolveReferencePoint(references[2], state);

  if (!point || !lineStart || !lineEnd) {
    return null;
  }

  const deltaX = lineEnd.x - lineStart.x;
  const deltaY = lineEnd.y - lineStart.y;

  const lengthSquared =
    deltaX * deltaX + deltaY * deltaY;

  if (lengthSquared < 1e-12) {
    return null;
  }

  /*
   * The projection parameter is NOT clamped to [0, 1].
   *
   * Clamping would turn the perpendicular distance into the distance to the
   * nearest END for a point that sits beyond the line's drawn extent - which
   * is a different measurement, and not the one an engineering drawing means
   * by "distance from a point to a line".
   */
  const t =
    ((point.x - lineStart.x) * deltaX +
      (point.y - lineStart.y) * deltaY) /
    lengthSquared;

  const foot = {
    x: lineStart.x + deltaX * t,
    y: lineStart.y + deltaY * t
  };

  return [point, foot];
}

/*
 * The two points a stored-value measurement is drawn between.
 *
 * A shaft's diameter is a number it holds, not a distance between two
 * of its points - its centreline has no pair of points that ARE the
 * diameter. So the value is placed on the feature's own extent at its own
 * radius, which is where those points physically are.
 *
 * A diameter therefore runs across the body and a radius from the
 * centreline out to the surface, drawn on the real shape rather than

 * floating beside it.
 *
 * Null when the reference is not a stored value, or the value is not a

 * finite positive number - in which case the caller falls back to its

 * normal handling and nothing is drawn rather than something wrong.

 */
function propertyReferencePoints(
  reference,
  state
) {
  if (!reference || reference.kind !== "property") {
    return null;
  }

  const object = findObject(
    state,
    reference.featureId
  );

  if (!object) {
    return null;
  }

  const radius = featureRadius(object);

  if (
    !Number.isFinite(radius) ||
    radius <= 0
  ) {
    return null;
  }

  const span = enggMeasurement.twoPointSpan(object);

  if (!span) {
    return null;
  }

  const centre = {
    x: (span.start.x + span.end.x) / 2,
    y: (span.start.y + span.end.y) / 2
  };

  const deltaX = span.end.x - span.start.x;
  const deltaY = span.end.y - span.start.y;
  const length = Math.hypot(deltaX, deltaY);

  if (length < 1e-9) {
    return null;
  }

  /*
   * Across the body for a diameter, out to the surface for a radius,

   * measured perpendicular to the centreline - which is the direction a

   * reader expects both to run.

   */
  const axis = {
    x: deltaX / length,
    y: deltaY / length
  };

  const across = {
    x: -axis.y,
    y: axis.x
  };

  /*
   * A DIAMETER crosses the body, so its two points sit one radius
   * either side of the centreline. A RADIUS runs from the centreline out
   * to the surface, so it needs the centre as one of its points.
   *
   * Drawing a radius as centre-to-centre-plus would state the diameter
   * again under a different symbol, which is the same class of error as
   * the chord-as-diameter this file was written to prevent.
   */
  if (reference.property === "radius") {
    return [
      centre,
      {
        x: centre.x + across.x * radius,
        y: centre.y + across.y * radius
      }
    ];
  }

  return [
    {
      x: centre.x - across.x * radius,
      y: centre.y - across.y * radius
    },
    {
      x: centre.x + across.x * radius,
      y: centre.y + across.y * radius
    }
  ];
}


function resolveReferencePoint(
  reference,
  state
) {
  if (reference?.kind === "canvas-point") return reference.point || null;
  const object = findObject(
    state,
    reference.featureId
  );

  if (!object) {
    return null;
  }

  /*
   * A reference to a value rather than to a place - a shaft's
   * diameter, a circle's radius. It has no point, and is handled by
   * measurementForProperty instead.
   */
  if (reference.kind === REFERENCE_KINDS.property) {
    return null;
  }

  return (
    enggMeasurement.resolveAnchor(
      object,
      reference.anchor
    )
  );
}

function findObject(state, objectId) {
  return (
    (state?.objects || []).find(
      (object) => object.id === objectId
    ) || null
  );
}

/*
 * A dimension's value, in drawing units.
 *
 * The measurement is computed here, in drawing units, and NOWHERE ELSE.
 * There is no world scale to convert it through any more: the drawing is
 * schematic, one drawing unit is one millimetre, and the value a dimension
 * reports is the geometry's own size. That is also why zooming the canvas
 * cannot change a 100 mm line into a 200 mm one - the zoom is a viewport
 * transform and this function never sees it.
 *
 * Returns null when the dimension cannot be resolved, so a caller
 * can tell "no measurement" from "a measurement of zero".
 */
function measurementFor(
  dimension,
  state
) {
  const propertyRef = (
    dimension?.sourceRefs || []
  ).find(
    (reference) =>
      reference.kind === REFERENCE_KINDS.property
  );

  if (propertyRef) {
    return measureProperty(
      dimension,
      propertyRef,
      state
    );
  }

  const points = measurePoints(dimension, state);

  if (!points) {
    return null;
  }

  const type = dimension.dimensionType;

  if (type === "angular") {
    return measureAngle(
      dimension,
      points,
      state
    );
  }

  if (type === "radius" || type === "diameter") {
    /*
     * A radius or diameter is a SINGLE point on the feature's own
     * edge, read against its centre - not a distance from the
     * centre to the anchor, because the centre is not where the
     * dimension is placed. The value comes from the feature's own
     * radius, which is why changing a circle's radius changes it.
     */
    return measureRadius(
      dimension,
      state,
      type === "diameter"
    );
  }

  if (type === "arc-length") {
    return measureArcLength(dimension, state);
  }

  const [first, second] = points;

  const drawingUnits =
    type === "horizontal"
      ? Math.abs(second.x - first.x)
      : type === "vertical"
        ? Math.abs(second.y - first.y)
        : Math.hypot(
              second.x - first.x,
              second.y - first.y
            );

  return toEngineering(
    state,
    drawingUnits
  );
}

/*
 * A circular measurement, from the feature that owns the circle.
 *
 * Read from the geometry rather than measured between two anchors,
 * so that the value is the circle's real radius and a circle whose
 * radius is edited updates the dimension that states it.
 */
function measureRadius(
  dimension,
  state,
  doubled
) {
  const reference = dimension.sourceRefs[0];

  if (!reference) {
    return null;
  }

  const object = findObject(
    state,
    reference.featureId
  );

  if (!object) {
    return null;
  }

  const radius = featureRadius(object);

  if (radius === null) {
    return null;
  }

  return toEngineering(
    state,
    doubled ? radius * 2 : radius
  );
}

/*
 * A circular feature's radius, from whichever of its own fields
 * actually carries it.
 *
 * A Circle and an Arc both store a radius. A Shaft stores a
 * DIAMETER, because that is what a shaft is specified by - so a
 * shaft's radius is half of it, and measuring the shaft's
 * centreline as if it were the exterior would state a number half
 * the true one.
 */
function featureRadius(object) {
  const geometry = object.geometry || {};

  if (Number.isFinite(Number(geometry.radius))) {
    return Number(geometry.radius);
  }

  if (
    Number.isFinite(Number(geometry.diameter))
  ) {
    return Number(geometry.diameter) / 2;
  }

  return null;
}

/*
 * A measurement taken from a feature's own value.
 *
 * Only values that exist explicitly are read. Nothing here derives
 * a quantity the feature does not already state - a shaft's
 * diameter is read, not recomputed from its span, and no force is
 * ever read as a force because the module that would do it does not
 * exist.
 */
function measureProperty(
  dimension,
  reference,
  state
) {
  const object = findObject(
    state,
    reference.featureId
  );

  if (!object) {
    return null;
  }

  const geometry = object.geometry || {};

  const value = geometry[reference.property];

  if (!Number.isFinite(Number(value))) {
    return null;
  }

  return toEngineering(state, Number(value));
}

/*
 * The included angle between two spans.
 *
 * Reported in degrees and dimensionless - a 30 degree dimension
 * reads "30Â°", never "30 mmÂ°", because an angle is not a length and
 * giving it a unit would be asserting that it is one.
 *
 * Only spans that actually have two ends can produce an angle. A
 * dimension between two points is a distance, not an angle, and
 * saying otherwise would let a right-angle dimension appear where
 * there is no direction to measure an angle between.
 */
function measureAngle(
  dimension,
  points,
  state
) {
  const [first, second] = points;

  /*
   * THE SPANS, not the measured points.
   *
   * An included angle needs a direction on each side, and a
   * direction comes from a span's two ends. Handing spanDirection a
   * single measured point gave it nothing to work with, so every
   * angle silently measured nothing.
   *
   * The references must also be to DIFFERENT features: a dimension
   * between two points of one span is a distance across that span,
   * and there is no angle in it.
   */
  const [firstRef, secondRef] =
    dimension.sourceRefs || [];

  /*
   * EACH REFERENCE RESOLVES ITS OWN SPAN.
   *
   * NOT the feature's span. A reference may name one EDGE of a multi-edge
   * feature, and for two sides of a single triangle the feature's span is the
   * same object for both - which made their angle zero or about the wrong
   * lines. See `spanOfReference`.
   */
  const firstSpan = spanOfReference(state, firstRef);

  const secondSpan = spanOfReference(state, secondRef);

  /*
   * ========================================================
   * THE ANGLE IS TAKEN BETWEEN THE TWO LEGS AT THE VERTEX
   * ========================================================
   *
   * AN ANGLE BETWEEN TWO LINES DOES NOT DEPEND ON WHICH WAY EACH WAS
   * DRAWN, and taking the angle between the raw `end - start` vectors
   * made it depend on exactly that. A line stored right-to-left has a
   * direction 180 degrees from the same line stored left-to-right, so
   * the SAME pair of lines measured 53 degrees or 127 degrees
   * according to nothing but the order their endpoints happened to be
   * saved in. The number was wrong, and it changed when unrelated
   * geometry was edited.
   *
   * So the legs are built the way the RENDERER builds them: from the
   * vertex where the two spans meet, each pointing out along its own
   * span. `legDirection` chooses the span end FURTHER from the vertex,
   * so a span with the vertex at one of its own ends still gives a
   * real direction rather than a zero vector - and a span whose
   * vertex is beyond its drawn extent still points the right way.
   *
   * This is the same `a`, `b` and vertex the drawn arc is built from,
   * so the label and the arc cannot state different angles. That is
   * the property this file was originally written to protect, and it
   * is why the computation lives here rather than beside the drawing.
   */
  const vertex = nearestVertex(firstSpan, secondSpan);

  /*
   * ========================================================
   * THE CURSOR CHOOSES WHICH OF THE FOUR SECTORS IS DIMENSIONED
   * ========================================================
   *
   * Two lines crossing make FOUR angular regions, and they come in two
   * values: the angle between the line axes, and its supplement. For a
   * 35-degree pair the four sectors read 35, 145, 35, 145.
   *
   * WHICH ONE IS DIMENSIONED IS THE STUDENT'S CHOICE, made by where they
   * put the dimension - and that position is already stored, in world
   * units, as `dimension.placement`. So the sector is DERIVED from the
   * placement rather than stored beside it: there is one piece of state to
   * keep in step with the geometry, not two, and it survives zoom, pan,
   * save and reload for the same reason the placement does.
   *
   * A dimension with no placement yet - a probe built to measure - falls
   * back to the geometric legs, which is the behaviour that existed before
   * the cursor could choose.
   */
  const legs = angleSectorLegs(
    vertex,
    firstSpan,
    secondSpan,
    dimension.placement
  );

  const a = legs ? legs.a : vertex
    ? legDirection(vertex, firstSpan.start, firstSpan.end)
    : spanDirection(firstSpan);

  const b = legs ? legs.b : vertex
    ? legDirection(vertex, secondSpan.start, secondSpan.end)
    : spanDirection(secondSpan);

  /*
   * If the references do not resolve to spans, there is no
   * direction to measure an angle between, and the answer is no
   * measurement rather than an assumed one.
   */
  if (!a || !b) {
    const deltaX = second.x - first.x;
    const deltaY = second.y - first.y;

    if (
      Math.abs(deltaX) < 1e-12 &&
      Math.abs(deltaY) < 1e-12
    ) {
      return null;
    }

    /*
     * Two points with no direction between them have no included
     * angle. Reported as null rather than as zero, because zero
     * would be a claim that they are parallel.
     */
    return null;
  }

  const angle = includedAngleDegrees(a, b);

  if (angle === null) {
    return null;
  }

  return {
    value: angle,

    /*
     * Angles are dimensionless. This flag is what stops a unit being
     * appended and what makes the degree sign appear instead, so
     * without it a right angle reads "90.00" rather than "90Â°".
     */
    unit: "deg",
    angular: true,
    degrees: true,
  };
}

/*
 * The angle two legs subtend, in degrees, as a number a drafting
 * reader expects.
 *
 * The legs are the two directions at the vertex, so the angle between
 * them is the INCLUDED angle - the one the arc is drawn through and
 * the one the reader checks against the extension lines.
 *
 * It is taken with atan2 of the cross product and the dot product,
 * which stays correct for obtuse angles where an acos of the dot
 * alone would need its sign restored, and the ABSOLUTE value makes it
 * the unsigned angle between the two directions. Because the legs are
 * built from the vertex rather than from each span's own start-to-end
 * direction, that value no longer changes when a line is stored the
 * other way round.
 *
 * Null when either direction is degenerate: a zero-length leg has no
 * direction, and an angle to nothing is unanswerable rather than zero.
 */
function includedAngleDegrees(a, b) {
  const lengthA = Math.hypot(a.x, a.y);
  const lengthB = Math.hypot(b.x, b.y);

  if (lengthA < 1e-9 || lengthB < 1e-9) {
    return null;
  }

  const dot = a.x * b.x + a.y * b.y;

  const determinant = a.x * b.y - a.y * b.x;

  const degrees =
    (Math.atan2(determinant, dot) * 180) / Math.PI;

  return Math.abs(degrees);
}

/*
 * ========================================================
 * THE SPAN A DIMENSION REFERENCE ACTUALLY NAMES
 * ========================================================
 *
 * A reference is not always "a whole feature". It may name ONE EDGE of a
 * feature - `segment1Start` / `segment1End` for a triangle's second side, a
 * rectangle's top edge, one segment of a polyline - and the anchors are what
 * say which.
 *
 * THE FEATURE'S OWN SPAN IS THE WRONG ANSWER FOR THOSE, and using it was the
 * defect this fixes. `twoPointSpan(triangle)` describes the triangle as a
 * whole (its first point to its last), not the side the student clicked, so
 * TWO SIDES OF ONE TRIANGLE both resolved to the SAME span - and their
 * "angle" was either zero or a number about the wrong lines entirely.
 *
 * THE OTHER END IS FOUND FROM THE ONE WE HAVE, when it is not stored.
 *
 * A segment reference names its edge by a matching PAIR of anchors, and a
 * `segment{i}Start` implies `segment{i}End`. Refs written today carry both,
 * but a dimension saved before that, or built directly by a caller, may carry
 * only the first - and such a reference is still perfectly clear about which
 * edge it means. Deriving the partner anchor keeps those working rather than
 * silently falling back to the feature span.
 *
 * The feature's span is the last resort, for a reference that genuinely names
 * a whole straight body: a Line, a Beam, a Cable, a Shaft. That is the common
 * case and it is unchanged.
 */
function spanOfReference(state, reference) {
  const featureId = reference?.featureId;
  const object = findObject(state, featureId);

  if (!object) {
    return null;
  }

  const anchor = reference?.anchor;

  /*
   * THE PARTNER ANCHOR: the one stored, or the matching `Start`/`End` of the
   * same segment derived from the anchor we have.
   */
  let endAnchor = reference?.endAnchor;

  if (!endAnchor && anchor) {
    endAnchor = partnerSegmentAnchor(anchor);
  }

  if (anchor && endAnchor) {
    const start = enggMeasurement.resolveAnchor(object, anchor);
    const end = enggMeasurement.resolveAnchor(object, endAnchor);

    if (start && end) {
      return { start, end };
    }
  }

  return enggMeasurement.twoPointSpan(object);
}

/*
 * The other end of the same named segment.
 *
 *   `segment3Start` -> `segment3End`
 *   `segment3End`   -> `segment3Start`
 *   `segment3Mid`   -> null   (a single point names no span)
 *
 * Null for any anchor that is not a segment end, so a named point or a
 * whole-feature reference is left alone.
 */
function partnerSegmentAnchor(anchor) {
  const match = /^(segment\d+)(Start|End)$/.exec(String(anchor || ""));

  if (!match) {
    return null;
  }

  const [, segment, end] = match;

  return end === "Start" ? `${segment}End` : `${segment}Start`;
}

function spanDirection(span) {
  if (!span) {
    return null;
  }

  if (span.start && span.end) {
    const deltaX = span.end.x - span.start.x;
    const deltaY = span.end.y - span.start.y;

    return { x: deltaX, y: deltaY };
  }

  return null;
}



/*
 * The length along an arc's sweep.
 *
 * From the arc's own radius and sweep, which are the feature's real
 * values - so editing either updates the dimension. The straight
 * chord is NOT substituted: it is a different number, and for a
 * wide arc the difference is large enough to matter.
 */
function measureArcLength(
  dimension,
  state
) {
  const reference = dimension.sourceRefs[0];

  if (!reference) {
    return null;
  }

  const object = findObject(
    state,
    reference.featureId
  );

  if (!object) {
    return null;
  }

  const geometry = object.geometry || {};

  const radius = Number(geometry.radius);

  const sweep = Math.abs(
    Number(geometry.endAngle) -
      Number(geometry.startAngle)
  );

  if (
    !Number.isFinite(radius) ||
    !Number.isFinite(sweep)
  ) {
    return null;
  }

  return toEngineering(state, radius * sweep);
}

/*
 * A measured length in drawing units, as the number a dimension reports.
 *
 * ONE DRAWING UNIT IS ONE MILLIMETRE.
 *
 * The retired world-scale system used to convert here - drawing units through
 * a calibrated mm-per-unit figure, so a line drawn 40 long could read 4 m. That
 * system is gone: DAETUM is schematic, the drawing's own units ARE the reported
 * unit, and there is nothing left to convert through.
 *
 * The shape of the result is kept - `value`, `unit`, `angular` - because every
 * caller already reads those fields, and `angular` is what tells the formatter
 * to write a degree sign rather than a length unit.
 */
function toEngineering(
  _state,
  drawingUnits
) {
  return {
    value: drawingUnits,
    unit: "mm",
    angular: false,
  };
}

/*
 * ========================================================
 * DISPLAY
 * ========================================================
 */

/*
 * The text a dimension shows.
 *
 * Formatted from the measurement every time it is asked for, never
 * stored. The prefix is part of the measurement - R and Ã˜ are what
 * distinguish a radius from a diameter - and the unit is omitted for
 * an angle because an angle is not a length.
 */
function formatMeasurement(
  dimension,
  state
) {
  if (dimension?.dimensionKind === "variable") {
    return isResolved(dimension, state) ? String(dimension.content || "") : null;
  }
  const override =
    typeof dimension?.label === "string"
      ? dimension.label.trim()
      : "";

  if (override) {
    return override;
  }

  /*
   * A MEASUREMENT WITH NO NUMBER BEHIND IT STILL OWES ITS READER A VALUE.
   *
   * The definition's prefix is what tells a reader WHICH quantity is stated - `R`
   * for a radius, `\u00d8` for a diameter - and it is decided by the dimension's
   * TYPE, which does not depend on the geometry resolving. So a dimension whose
   * references are momentarily absorbed has a prefix to draw even when it has no
   * number, and the caller (`graphicsFor`) can still draw the construction.
   */
  const definition =
    enggMeasurement.DIMENSION_TYPES[
      dimension.dimensionType
    ];

  const measurement = measurementFor(
    dimension,
    state
  );

  if (!measurement) {
    return null;
  }



  const precision = resolvePrecision(dimension, state);

  const rounded = round(
    measurement.value,
    precision
  );

  /*
   * Fixed to the stated precision HERE, where the number becomes
   * text, rather than by the rounding helper - which is a numeric
   * function and drops trailing zeros as a matter of course.
   *
   * Dimensions are read together, and "100 mm" beside "100.25 mm"
   * implies the first is the less precise measurement of the two.
   * Engineering dimensions are shown at one consistent precision
   * precisely so they can be compared at a glance.
   */
  const value = formatAtPrecision(
    rounded,
    precision
  );

  /*
   * THE UNIT IS THE DRAWING'S. A dimension reads the geometry in drawing units,
   * which are millimetres on the sheet, and writes that number - there is no
   * per-dimension unit to convert into (a `displayUnit` read in cm or m was part
   * of the retired world-length system). Any other wording is the dimension's
   * own label, set as annotation text. An ANGLE has no length unit.
   */
  const unit = measurement.unit;
  const shown = rounded;

  /*
   * ONE FORMATTER FOR EVERY DIMENSION.
   *
   * The unit used to be conditional on a per-dimension `showUnits` style
   * flag, which meant a dimension could be created and drawn as a bare
   * number that gained its unit only once something set that flag. A
   * dimension with no unit is ambiguous with any other quantity of the same
   * magnitude on the same drawing - a 250 mm span beside a 250 N force -
   * so the unit is part of what the number means rather than a piece of
   * dressing, and it is now written unconditionally.
   *
   * An angle carries the degree sign and no length unit, because it is not
   * a length.
   *
   * NO TILDE, ever: a dimension reports the geometry's own size, which is
   * exact for that drawing, so there is nothing provisional to mark.
   */
  const formatter = enggQuantities;

  /*
   * THE FORMATTER IS FALLEN BACK ON, NEVER ABSENT.
   *
   * These models are also loaded on their own - by the module-load check,
   * and by tests that exercise the measurement without the presentation -
   * so reaching for the formatter directly would make a dimension
   * unmeasurable in those contexts. The fallback below is the same rule
   * written twice, which is the cost of the models being loadable apart.
   */
  /*
   * THE TYPE'S PREFIX, READ AT THE POINT IT IS USED. The local that held it was
   * declared twice (once before the measurement was made and once after), which
   * is a SyntaxError in a module - the whole dimension model failed to load. One
   * declaration, here, beside the unit it belongs with.
   */
  const prefix = definition?.prefix || "";

  if (!formatter) {
    return measurement.angular
      ? `${prefix}${value}°`
      : `${prefix}${formatAtPrecision(shown, precision)} ${unit}`;
  }

  return formatter.formatLength(shown, unit, {
    prefix,
    precision,
    angular: measurement.angular === true,
  });
}

function resolvePrecision(dimension, state) {
  /*
   * Zero is a legitimate precision - a drawing dimensioned in whole
   * millimetres should read "125 mm", not "125.00 mm" - so the test
   * is whether a value was supplied, not whether it is truthy.
   * Only a genuinely absent precision falls back to the default.
   */
  const fromStyle = dimension?.style?.precision;

  if (fromStyle !== null && fromStyle !== undefined) {
    const number = Number(fromStyle);

    if (Number.isFinite(number)) {
      return number;
    }
  }

  const fromDocument =
    state?.dimensionPrecision ??
    state?.styleDefaults?.dimensionPrecision;

  if (
    fromDocument !== null &&
    fromDocument !== undefined
  ) {
    const number = Number(fromDocument);

    if (Number.isFinite(number)) {
      return number;
    }
  }

  return DEFAULT_PRECISION;
}

function formatAtPrecision(value, precision) {
  const places = Math.max(
    0,
    Math.min(6, Math.round(Number(precision) || 0))
  );

  const text = Number(value).toFixed(places);

  /*
   * Zero decimal places is a whole number and should read as one -
   * "125 mm", not "125 mm" with a stray point.
   */
  return places === 0 ? String(Number(text)) : text;
}

function round(value, precision) {
  const places = Math.max(
    0,
    Math.min(6, Math.round(Number(precision) || 0))
  );

  const factor = 10 ** places;

  /*
   * Rounding through a factor and dividing back can produce
   * 3.9999999999 or 4.0000000001 in binary floating point, and a
   * dimension that reads "4.0000000001 mm" is a defect the user sees
   * every time. The epsilon nudges values that are a rounding
   * artefact away from a boundary back onto it, so the number shown
   * is the number meant.
   */
  const rounded =
    Math.round(value * factor * (1 + Number.EPSILON)) /
    factor;

  /*
   * Fixed to the stated precision rather than left to
   * JavaScript's number-to-string, which drops trailing zeros.
   *
   * This is not cosmetic. Two dimensions on one drawing are read
   * together, and "100 mm" beside "100.25 mm" implies the first is
   * a rounder, less precise measurement than it is. Engineering
   * dimensions are shown at a consistent precision precisely so
   * they can be compared at a glance.
   */
  return Object.is(rounded, -0) ? 0 : rounded;
}

/*
 * ========================================================
 * RESOLUTION STATE
 * ========================================================
 */

/*
 * Whether a dimension can currently be measured.
 *
 * Computed, not remembered. A dimension's resolved state is a fact
 * about the geometry it references, and storing it would let the two
 * disagree - the drawing would say "resolved" while showing an
 * empty dimension, or the reverse.
 */
function isResolved(dimension, state) {
  return measurementFor(dimension, state) !== null;
}

/*
 * ========================================================
 * REDUNDANCY
 * ========================================================
 */

/*
 * Whether a candidate measurement is already stated.
 *
 * Smart Dimension uses this so that dimensioning a beam that already
 * has its span does not put a second, identical span beside it.
 *
 * The comparison is on the measurement itself - same type, same
 * source features, same anchors - not on the dimension's identity or
 * position, because a second dimension of the same thing is
 * redundant wherever it happens to sit.
 */
function describesSameAs(dimension, candidate) {
  if (
    !dimension ||
    !candidate ||
    dimension.dimensionType !==
      candidate.dimensionType
  ) {
    return false;
  }

  /*
   * A proposal and a dimension are the same measurement at different
   * stages - one has not been created yet - so the comparison reads
   * whichever shape it is given rather than insisting on a created
   * one.
   *
   * Insisting on a dimension is what made this always fail when
   * given a proposal: Smart Dimension proposes with `refs` and a
   * created dimension stores `sourceRefs`, so nothing ever matched
   * and nothing was ever suppressed.
   */
  const existing =
    dimension.sourceRefs ||
    dimension.refs ||
    [];

  const proposed =
    candidate.sourceRefs ||
    candidate.refs ||
    [];

  if (existing.length !== proposed.length) {
    return false;
  }

  /*
   * Both sides are reduced to a canonical form before being
   * compared.
   *
   * A comparison that checks every field for exact equality has to
   * be right about all of them, and one that is wrong about any
   * single field reports two different measurements as the same -
   * or, as happened here, the same measurement as different, and
   * suppressed nothing.
   *
   * Normalising first settles how a reference was SPELLED - its
   * kind, which properties it carries, which end was named first -
   * so that what is left to compare is only what was MEASURED.
   */
  const canonical = (references) =>
    references
      .map((reference) => {
        const kind = reference.kind || "between";

        const canonicalised = {
          kind,
          featureId: reference.featureId
        };

        /*
         * Only the fields that identify the measurement. "anchor"
         * and "property" are alternatives - a property reference
         * names a value rather than a place - and including both
         * would make a measurement with an unused field look
         * different from the same measurement without it.
         */
        if (kind === "property") {
          canonicalised.property =
            reference.property ?? null;
        } else {
          canonicalised.anchor =
            reference.anchor ?? null;
        }

        return canonicalised;
      })
      .sort((a, b) =>
        JSON.stringify(a) < JSON.stringify(b) ? -1 : 1
      );

  return (
    JSON.stringify(canonical(existing)) ===
    JSON.stringify(canonical(proposed))
  );
}

/*
 * Whether anything already in the document states this measurement.
 */
function alreadyStated(
  candidate,
  state
) {
  return (state?.objects || []).some(
    (object) =>
      object.type === "dimension" &&
      describesSameAs(object, candidate)
  );
}

/*
 * ========================================================
 * GEOMETRY THE DIMENSION GENERATES
 * ========================================================
 */

/*
 * The lines and text a dimension draws, in world coordinates.
 *
 * RETURNED, NOT DRAWN. The dimension is not a picture of itself:
 * this describes what a dimension means graphically, and the
 * renderer decides how to draw it. That is what keeps the dimension
 * identical in the canvas, in an export and in a figure in the
 * written solution - there is one description and three uses of it.
 *
 * Extension lines, witness lines, the dimension line and its
 * arrowheads are all generated from the geometry each time, so a
 * dimension that is moved redraws correctly and a dimension whose
 * source has moved redraws correctly.
 */
function graphicsFor(
  dimension,
  state
) {
  const measurement = measurementFor(
    dimension,
    state
  );

  const text = formatMeasurement(dimension, state);

  if (!measurement || !text) {
    return null;
  }

  const propertyRef = (
    dimension.sourceRefs || []
  ).find(
    (reference) =>
      reference.kind === REFERENCE_KINDS.property
  );

  const object = propertyRef
    ? findObject(state, propertyRef.featureId)
    : null;

  /*
   * A radial or property measurement is drawn from its centre, so it
   * is a different shape from a linear one and gets its own
   * description. Everything else is a linear dimension between two
   * points.
   */
  /*
   * Dispatched on the MEASUREMENT TYPE, not on how the dimension
   * refers to its feature.
   *
   * A diameter is radial whichever way it is referenced: the shaft
   * case carries a property reference to its own diameter field,
   * while a circle is referred to by one of its anchors. Looking for
   * a property reference only - which is what this did - meant a
   * diameter against a circle silently skipped the radial branch
   * and drew nothing at all.
   */
  if (
    dimension.dimensionType === "radius" ||
    dimension.dimensionType === "diameter"
  ) {
    /*
     * The feature is found from whichever reference exists, so a
     * radial dimension draws from the circle or the shaft it
     * actually measures.
     */
    const radialReference =
      propertyRef ||
      (dimension.sourceRefs || [])[0];

    return radialGraphics(
      dimension,
      state,
      object,
      measurement,
      text,
      radialReference
    );
  }

  if (
    dimension.dimensionType === "angular"
  ) {
    return angularGraphics(
      dimension,
      state,
      measurement,
      text
    );
  }

  /*
   * AN ARC LENGTH RUNS ALONG ITS ARC
   *
   * `arc-length` is declared with `graphic: "linear"` in the type table, so
   * without this branch it fell through to `linearGraphics` and was drawn as a
   * straight chord between the arc's two ends - a different number from the one
   * printed on it, and one that looks like a plain linear dimension. The value
   * was right; the picture contradicted it.
   */
  if (
    dimension.dimensionType === "arc-length"
  ) {
    return arcLengthGraphics(
      dimension,
      state,
      measurement,
      text
    );
  }

  return linearGraphics(
    dimension,
    state,
    measurement,
    text
  );
}

/*
 * The direction a linear dimension runs in.
 *
 * "auto" follows the thing measured: a horizontal measurement is
 * drawn horizontally, a vertical one vertically, and an aligned one
 * along the line it measures. That is what makes a dimension look
 * like it belongs to the geometry rather than being a number
 * floating near it.
 */
function dimensionDirection(dimension, points) {
  const [first, second] = points;

  const explicit = dimension.orientation;

  if (
    explicit &&
    explicit !== ORIENTATIONS.auto
  ) {
    if (explicit === ORIENTATIONS.horizontal) {
      return { x: 1, y: 0 };
    }

    if (explicit === ORIENTATIONS.vertical) {
      return { x: 0, y: 1 };
    }

    return normalise({
      x: second.x - first.x,
      y: second.y - first.y,
    });
  }

  switch (dimension.dimensionType) {
    case "horizontal":
      return { x: 1, y: 0 };

    case "vertical":
      return { x: 0, y: 1 };

    default:
      /*
       * An aligned or linear dimension follows the geometry. For a
       * pure horizontal span that is horizontal anyway, and for an
       * angled one it is the line itself - which is what makes an
       * angled dimension legible instead of a number at a strange
       * angle.
       */
      return normalise({
        x: second.x - first.x,
        y: second.y - first.y,
      });
  }
}

/*
 * A UNIT VECTOR, with a defined answer for a vector of no length.
 *
 * The +X fallback is for a caller that has already established the span is
 * degenerate and needs SOME direction; it is never used to invent a dimension.
 */
function normalise(vector) {
  const length = Math.hypot(vector.x, vector.y);

  if (length < 1e-12) {
    return { x: 1, y: 0 };
  }

  return {
    x: vector.x / length,
    y: vector.y / length,
  };
}

/*
 * Perpendicular to a direction, used to stand the dimension line off
 * the geometry it measures.
 */
function perpendicular(direction) {
  return { x: -direction.y, y: direction.x };
}

/*
 * ========================================================
 * THE SIDE A DIMENSION STANDS OFF ON
 * ========================================================
 *
 * ALWAYS A WORLD-DERIVED NORMAL, never the raw perpendicular.
 *
 * A HORIZONTAL dimension stands off VERTICALLY and a VERTICAL one HORIZONTALLY,
 * whatever the measured points are - that is the whole of what makes it a
 * horizontal or a vertical dimension rather than an aligned one. Deriving the
 * normal from the stored direction alone was right for a level span and wrong
 * for everything else: a rectangle's width dimension whose two anchors were
 * not exactly level got a normal a fraction off vertical, and because the
 * dimension's position is a POINT on that plane, a slightly tilted plane
 * threw the line across the sheet.
 *
 * An ALIGNED dimension keeps the true perpendicular, because following the
 * measured segment is what it is for.
 */
function dimensionNormal(dimension, direction) {
  const orientation = dimension?.orientation;

  const type = dimension?.dimensionType;

  if (
    type === "horizontal" ||
    (orientation === ORIENTATIONS.horizontal && type !== "vertical")
  ) {
    return { x: 0, y: 1 };
  }

  if (type === "vertical" || orientation === ORIENTATIONS.vertical) {
    return { x: 1, y: 0 };
  }

  return perpendicular(direction);
}

/*
 * Where the dimension text is drawn, and which way up.
 *
 * A dimension is only readable if its text is upright. A dimension
 * line running left-to-right gets horizontal text; one running
 * bottom-to-top gets text reading upward from the left; and one
 * running right-to-left would put the text upside down, so it is
 * flipped and its anchor moves with it.
 *
 * That flipping is the difference between a drawing whose dimensions
 * can be read at a glance and one the reader has to tilt their head
 * for. It is done here, once, rather than by each consumer.
 */
function textFrame(
  position,
  direction,
  fontSize = DIMENSION_DEFAULT_FONT_PT,
  label = null,
  alignment = "center"
) {
  const { x, y } = direction;

  /*
   * Beyond vertical: reading bottom-to-top is the convention, and
   * anything past that is upside down.
   */
  const angle = (Math.atan2(y, x) * 180) / Math.PI;

  const normalised =
    angle > 90 || angle < -90
      ? angle + 180
      : angle;

  return {
    /*
     * The centre, under BOTH names (`x`/`y` for the model's readers, `center`
     * for the renderer and the source writer), and the EXTENT the number
     * occupies there.
     *
     * The extent is not decoration: the hit test needs a box to click, the
     * source writer needs to know where the line may be interrupted, and the
     * differential label offset is limited to it. All three read this one
     * measurement.
     */
    x: position.x,
    y: position.y,
    center: { x: position.x, y: position.y },
    width: label ? label.halfWidth * 2 : 0,
    height: label ? label.halfHeight * 2 : 0,
    fontSize,
    /*
     * THE TYPE HEIGHT IN DRAWING UNITS (mm), which is what a renderer paints - a
     * stored size in points is a print figure, and re-converting it to pixels is
     * how a label came to be drawn at several times its document size.
     */
    fontWorld: label ? label.fontWorld : 0,
    alignment,
    angle: normalised,
    flip: angle > 90 || angle < -90,
    vertical: Math.abs(normalised) > 45 && Math.abs(normalised) < 135,
  };
}

function linearGraphics(
  dimension,
  state,
  measurement,
  text
) {
  const points = measurePoints(dimension, state);

  if (!points || points.length < 2) {
    return null;
  }

  const [rawFirst, rawSecond] = points;

  const direction = dimensionDirection(
    dimension,
    points
  );

  const axis = normalise(direction);

  /*
   * The dimension line is offset from the geometry by where the user
   * placed it, measured PERPENDICULAR to the dimension's own
   * direction. The offset is signed, so placing the dimension on the
   * other side of the beam puts it there rather than snapping it
   * back.
   *
   * THE NORMAL IS WORLD-DERIVED AND POINTS "OUT": up for a horizontal
   * dimension, +X for a vertical one. `dimensionNormal` answers the axis; a
   * negative offset (a dimension placed ABOVE the geometry it measures) then
   * puts the line above, the witness lines run upward, and the number reads on
   * the far side of the line from the outline - which is the drafting
   * convention in both directions, not only below.
   */
  const anchor = dimensionNormal(dimension, axis);

  /*
   * ========================================================
   * THE DEFINING POINTS ORTHOGONAL TO THE MEASURED DIRECTION
   * ========================================================
   *
   * A horizontal dimension measures the distance along X, so its defining
   * points sit on the two measured points' own verticals: `(first.x, along)`
   * and `(second.x, along)`. A vertical dimension does the same along Y, and
   * an aligned one uses the measured points untouched. This is what makes the
   * dimension line parallel to the measured direction even when the measured
   * points are not level (a rectangle whose anchors sit a fraction apart in Y
   * still gets a level line), and it is why the value and the drawn span are
   * the same number by construction.
   */
  const across = perpendicular(axis);

  const alongCoordinate = (point) =>
    point.x * across.x + point.y * across.y;

  /*
   * THE MEASURED DIRECTION'S OWN PLANE IS THE ONE THROUGH THE MEASURED SPAN,
   * LEVEL WITH ITS MIDPOINT - not the placement's plane. A horizontal dimension
   * of a rectangle's bottom edge therefore measures along that edge: the two
   * defining points are level with each other AND with the outline, and the
   * witness lines run from the outline to the dimension line, as a drawing
   * shows. Taking the placement's own level instead would have put the defining
   * points ON the dimension line, leaving nothing to witness - and a witness
   * line whose ends are in the wrong place is worse than none.
   */
  const measuredAlong = alongCoordinate({
    x: (rawFirst.x + rawSecond.x) / 2,
    y: (rawFirst.y + rawSecond.y) / 2,
  });

  const first = projectPoint(rawFirst, across, measuredAlong);
  const second = projectPoint(rawSecond, across, measuredAlong);

  /*
   * How far the placement is from the geometry, along the
   * dimension's own normal. Signed so the user chooses the side.
   */
  const midpoint = {
    x: (first.x + second.x) / 2,
    y: (first.y + second.y) / 2,
  };

  const rawOffset =
    (dimension.placement.x - midpoint.x) * anchor.x +
    (dimension.placement.y - midpoint.y) * anchor.y;

  /*
   * A PLACEMENT ON THE OUTLINE IS PUSHED OFF IT BY THE OUTLINE'S OWN INK.
   *
   * A dimension dropped straight on the edge it measures has a zero offset - no
   * room for a dimension line, a witness line or a number. Half a pen of
   * clearance is the least that puts the construction clear of the outline's own
   * ink; a placement that already stands clear is left exactly where the student
   * put it. The clearance is in DRAWING UNITS, so it is a physical millimetre.
   */
  const inkClearance = dimensionPenMm(dimension.style) / 2;

  const offset =
    Math.abs(rawOffset) < inkClearance
      ? (rawOffset < 0 ? -1 : 1) * inkClearance
      : rawOffset;

  /*
   * ========================================================
   * THE DIMENSION LINE IS A PROJECTION OF THE MEASURED SPAN
   * ========================================================
   *
   * Both defining points are projected onto the plane the user placed the
   * dimension on, ALONG THE DIMENSION'S OWN NORMAL. That is what keeps the
   * line PARALLEL to the measured direction (its two ends come from the same
   * two points), lets the student choose the side and the distance with one
   * placement point, and stops a horizontal dimension from turning into a
   * diagonal one when the geometry it measures is not level.
   */
  const plane = dimension.placement.x * anchor.x + dimension.placement.y * anchor.y;
  const lineStart = projectPlane(first, anchor, plane);
  const lineEnd = projectPlane(second, anchor, plane);

  const label = dimensionLabelSize(text, state, dimension.style);

  /*
   * ========================================================
   * WITNESS LINES: FROM THE MEASURED POINT, PAST THE LINE
   * ========================================================
   *
   * An engineering witness line starts a small STAND-OFF from the geometry it
   * measures (so it does not touch the outline) and runs a small OVERSHOOT past
   * the dimension line (so the arrowhead has something to meet). Both lengths
   * are stated here, in drawing units, so the canvas and the TikZ source draw
   * the same two segments - a witness line that stopped AT the dimension line
   * on the canvas and one that overshot in TikZ would be two different
   * drawings.
   *
   * The stand-off is measured FROM THE MEASURED POINT ALONG THE WITNESS LINE,
   * which is the normal direction, so it is a real 1.5 mm of paper whether the
   * dimension line is 10 mm away or 100 mm away. The overshoot is added at the
   * line's end, in the same direction.
   */
  const standoff = WITNESS_STANDOFF_MM;
  const overshoot = WITNESS_OVERSHOOT_MM;

  /*
   * A WITNESS LINE RUNS ALONG THE DIMENSION'S NORMAL, IN WORLD TERMS.
   *
   * The measured point and the dimension line are on two parallel planes whose
   * distance apart IS the offset; a witness line therefore joins them along the
   * normal, from a stand-off clear of the outline out past the line. Using the
   * parallel planes rather than the raw point-to-line vector is what keeps the
   * two witness lines PARALLEL and perpendicular to their dimension line when
   * the measured edge is not exactly level - which is what a drafting reader
   * checks first.
   */
  const witness = (measured, linePoint) => {
    const onLine = validPoint(linePoint) ? linePoint : projectPlane(measured, anchor, plane);

    const reach = Math.abs(offset);

    /*
     * A dimension placed ON the geometry has no witness line to draw: the two
     * points coincide, and a zero-length segment (or one invented from a unit
     * vector) is not construction geometry, it is noise.
     */
    if (reach <= 1e-9) {
      return null;
    }

    /* The normal pointing from the measured point TOWARDS its dimension line. */
    const toward = { x: onLine.x - measured.x, y: onLine.y - measured.y };

    /*
     * A MEASURED POINT THAT IS ALREADY ON THE PLANE HAS NO WITNESS LINE.
     *
     * This happens for every dimension whose measured direction is not the
     * nominal one - a horizontal dimension of a sloped edge, whose defining
     * points lie on the level through the placement. There is no gap for a
     * witness line to bridge, and `normalise` would answer a zero vector with a
     * made-up +X direction: a witness line drawn sideways along the dimension
     * line, which is not construction geometry at all. The dimension line still
     * spans between those two points, so the construction stays complete.
     */
    if (Math.hypot(toward.x, toward.y) <= 1e-9) {
      return null;
    }

    const toLine = normalise(toward);

    /*
     * A stand-off longer than the gap would leave a witness line running the
     * wrong way. It is limited to a third of the gap, leaving the line visible
     * and still reaching past the dimension line.
     */
    const used = Math.min(standoff, reach * 0.33);
    const past = Math.min(overshoot, Math.max(0, reach - used) * 0.5);

    return [
      { x: measured.x + toLine.x * used, y: measured.y + toLine.y * used },
      { x: onLine.x + toLine.x * past, y: onLine.y + toLine.y * past },
    ];
  };

  const extensions = [
    witness(first, lineStart),
    witness(second, lineEnd),
  ].filter(Boolean);

  /*
   * ========================================================
   * WHICH WAY THE ARROWHEADS FACE
   * ========================================================
   *
   * The engineering convention: arrows point OUTWARDS, towards the witness
   * lines, and sit inside the span. When the span is too short for the heads to
   * fit between the witness lines they are turned round and drawn OUTSIDE the
   * span, so the number of the measurement is still the distance between the
   * heads.
   *
   * The rule compares the line with the space the heads need.
   */
  const arrowStyle = decideArrowStyle(lineStart, lineEnd, offset, dimension.style);

  const lineParallel = normalise({
    x: lineEnd.x - lineStart.x,
    y: lineEnd.y - lineStart.y,
  });

  /*
   * THE NUMBER FOLLOWS THE LINE IT SITS ON.
   *
   * A horizontal line gets level text, a vertical one text reading upward - and
   * an aligned dimension running down-hill gets text along its own line, never
   * upside down (the frame's own flip decides that). Reading the LINE rather than
   * the nominal orientation is what keeps an aligned label on its dimension line
   * when the measured edge is not level.
   */
  const textDirection = numberParallel(lineParallel)
    ? lineParallel
    : numberParallel(axis)
      ? axis
      : { x: 1, y: 0 };

  /*
   * THE TEXT SITS ON THE FAR SIDE OF THE LINE FROM THE GEOMETRY.
   *
   * Above a horizontal dimension, beside a vertical one, and on the outer side
   * of any other - which is where a reader looks for it and where the number
   * cannot be mistaken for part of the feature being measured. The clearance
   * includes the label's own depth so the glyphs never touch the line.
   */
  const side = offset < 0 ? -1 : 1;
  const clearance = label.halfHeight + label.gap;

  /*
   * A DELIBERATE TEXT REPOSITION, kept small.
   *
   * `style.offsetX` / `style.offsetY` are drawing units (mm) the student moved
   * the label by; they move the label ONLY - never the dimension line, never
   * the defining points, never the measurement. The offset is clamped to the
   * label's own extent so a stray value cannot detach the text from its
   * dimension.
   */
  const allow = {
    x: label.halfWidth + label.gap,
    y: Math.max(label.halfHeight + label.gap, 2),
  };

  const labelOffset = {
    x: clampNumber(dimension.style?.offsetX, -allow.x, allow.x),
    y: clampNumber(dimension.style?.offsetY, -allow.y, allow.y),
  };

  /*
   * `side` IS THE SIDE OF THE LINE THE MEASURED GEOMETRY IS NOT ON.
   *
   * A positive offset means the line was placed along `anchor` from the measured
   * points, so the geometry lies on the -anchor side and the number goes on the
   * +anchor side; a negative offset reverses both. The result is always: number
   * outermost, outline nearest the witness lines.
   *
   * THE SIDE OF THE PLACEMENT, NOT OF THE PAGE.
   *
   * The placement is where the student put the dimension LINE, and the witness
   * lines run from the geometry to it - so the geometry lies on the side of the
   * line that faces AWAY from the placement, and the number goes on the
   * placement's own side, just past the line. A dimension placed below a
   * rectangle reads below its line; one placed above it reads above. The same
   * rule holds for a line placed to either side of a vertical dimension, so no
   * dimension type hard-codes a side.
   */
  const textAnchor = {
    x: (lineStart.x + lineEnd.x) / 2 + anchor.x * clearance * side + labelOffset.x,
    y: (lineStart.y + lineEnd.y) / 2 + anchor.y * clearance * side + labelOffset.y,
  };

  /*
   * A NUMBER SET RIGHT OR LEFT IS STILL THE DIMENSION'S NUMBER.
   *
   * A left- or right-aligned label is moved half its own width so the alignment
   * turns about the SAME point rather than about a corner - the middle of the
   * dimension line - which keeps the text over its measurement however it is
   * justified. Centre alignment needs no shift, so the default construction is
   * untouched.
   */
  const alignment = dimensionTextAlignment(dimension.style);

  if (alignment === "left") {
    textAnchor.x += label.halfWidth * lineParallel.x;
    textAnchor.y += label.halfWidth * lineParallel.y;
  } else if (alignment === "right") {
    textAnchor.x -= label.halfWidth * lineParallel.x;
    textAnchor.y -= label.halfWidth * lineParallel.y;
  }

  return {
    kind: "linear",
    dimensionType: dimension.dimensionType,
    measurement,
    text,

    /* The two points actually measured - the defining points. */
    points: [rawFirst, rawSecond],

    /* The defining points placed on the measured direction's own planes. */
    anchors: [first, second],

    line: [lineStart, lineEnd],
    extensions,
    arrowStyle,

    /*
     * THE ARROWHEADS, AS PLACES AND DIRECTIONS rather than a style name.
     *
     * The renderer draws a triangle from these and the source writer turns them
     * into a TikZ head, so both are told the same tip and the same way round.
     */
    arrowheads: linearArrowheads(lineStart, lineEnd, arrowStyle),

    label,
    /*
     * WHICH SIDE OF THE DIMENSION LINE THE NUMBER HAS TO BE ON, for a caller
     * that needs the boundary rather than the centre - see `dimensionTextBounds`.
     */
    textSide: side,

    textFrame: textFrame(
      textAnchor,
      textDirection,
      label.fontPt,
      label,
      alignment
    ),
    textAnchor,
  };
}

/*
 * A point moved onto a plane defined by a unit normal: the point keeps its
 * position ALONG the plane and takes the plane's own distance ALONG the normal.
 */
function projectPoint(point, normal, planeValue) {
  const delta = planeValue - (point.x * normal.x + point.y * normal.y);

  return { x: point.x + normal.x * delta, y: point.y + normal.y * delta };
}

/* The same projection, for the dimension-line plane itself. */
function projectPlane(point, normal, planeValue) {
  return projectPoint(point, normal, planeValue);
}

/* Whether a value is a usable point. */
function validPoint(point) {
  return Boolean(
    point && Number.isFinite(Number(point.x)) && Number.isFinite(Number(point.y)),
  );
}

/* A finite number inside a range, or zero. */
function clampNumber(value, minimum, maximum) {
  const number = Number(value);

  if (!Number.isFinite(number) || number === 0) {
    return 0;
  }

  return Math.min(maximum, Math.max(minimum, number));
}



/* Whether a vector has a direction at all. */
function numberParallel(vector) {
  return Number.isFinite(vector?.x) && Number.isFinite(vector?.y) && Math.hypot(vector.x, vector.y) > 1e-9;
}

/* The label's horizontal alignment, from its own style. */
function dimensionTextAlignment(style = {}) {
  return ["left", "center", "right"].includes(style?.textAlign) ? style.textAlign : "center";
}



/*
 * The two arrowheads of a linear dimension.
 *
 * Inside: each head sits at its own end of the line and points along the line
 * towards the other end - towards the measured limit.
 *
 * Outside: each head is moved just beyond its end and points back IN towards
 * the span, which is the same measurement stated when there is no room for the
 * heads in it.
 */
function linearArrowheads(lineStart, lineEnd, arrowStyle) {
  const along = { x: lineEnd.x - lineStart.x, y: lineEnd.y - lineStart.y };
  const length = Math.hypot(along.x, along.y);

  if (length < 1e-9) {
    return [];
  }

  const unit = { x: along.x / length, y: along.y / length };

  if (arrowStyle === "outside") {
    const reach = ARROW_OUTSIDE_MM;

    return [
      {
        at: { x: lineStart.x - unit.x * reach, y: lineStart.y - unit.y * reach },
        direction: unit,
      },
      {
        at: { x: lineEnd.x + unit.x * reach, y: lineEnd.y + unit.y * reach },
        direction: { x: -unit.x, y: -unit.y },
      },
    ];
  }

  /*
   * INSIDE: each head sits IN the span at its own end and points OUT, at the
   * witness line it meets. That is the drawing convention, and it is also what
   * puts the head between the witness lines rather than outside them - a head
   * drawn on the far side of the measured point would state a distance longer
   * than the one the number gives.
   */
  return [
    { at: lineStart, direction: { x: -unit.x, y: -unit.y } },
    { at: lineEnd, direction: unit },
  ];
}

/* How far outside its end an outside arrowhead sits, in drawing units. */
const ARROW_OUTSIDE_MM = 3;

/*
 * Which way the arrowheads point.
 *
 * Outside when the dimension line stands far enough off the geometry
 * for the arrows to have room; inside when it does not. The decision
 * is made here so that a narrow dimension does not grow arrowheads
 * that overshoot the thing being measured.
 */
function decideArrowStyle(
  lineStart,
  lineEnd,
  offset,
  style = {}
) {
  const length = Math.hypot(
    lineEnd.x - lineStart.x,
    lineEnd.y - lineStart.y
  );

  /*
   * A SPAN WITH NO LENGTH HAS NO ROOM FOR ANY HEAD. It is not a dimension that
   * can state a distance, but it is also not one to throw: the caller draws
   * what it can, and outside heads are the honest choice for a zero span.
   */
  if (length < 1e-9) {
    return "outside";
  }

  /*
   * THE THRESHOLD IS THE SPACE THE HEADS THEMSELVES NEED.
   *
   * Two heads, each `dimensionArrowMm` long, plus a little clear of the text:
   * a dimension line shorter than that cannot hold both heads inside, so they
   * go outside and the number still states the distance between them. It is
   * derived from the DOCUMENT's arrow size, not from a screen unit, so the
   * decision is the same on the canvas, in the export and at any zoom.
   */
  const needed = dimensionArrowMm(style) * 2 + 6;

  return length < needed ? "outside" : "inside";
}

/*
 * AN ARC LENGTH, DRAWN ALONG THE ARC.
 *
 * The dimension follows the referenced arc's own sweep - a concentric arc at the
 * placement's offset from the centre - with a radius line out to each end, so the
 * reader can see WHICH sweep is being measured. The value is the same
 * `radius x |sweep|` the measurement layer computed; this function only decides
 * where to draw it.
 *
 * The sweep is taken from the feature's own start and end anchors rather than
 * from their difference clamped to +/-180 degrees. A major arc is a legitimate
 * arc, and a dimension that always drew the minor sweep would state a length the
 * geometry does not have.
 */
function arcLengthGraphics(
  dimension,
  state,
  measurement,
  text
) {
  const reference = (dimension.sourceRefs || [])[0];
  const object = findObject(state, reference?.featureId);
  const geometry = object?.geometry || {};

  const centre = enggMeasurement.resolveAnchor(object, "center");
  const start = enggMeasurement.resolveAnchor(object, "start");
  const end = enggMeasurement.resolveAnchor(object, "end");

  const radius = featureRadius(object);

  if (!centre || !start || !end || radius === null) {
    return null;
  }

  /*
   * The arc's true sweep, in the direction the geometry stores it. The stored
   * start/end angles are the authority; the anchor points are used only to keep
   * the drawn arc on the same side as the geometry when the angles are absent.
   */
  const startAngle = Number.isFinite(Number(geometry.startAngle))
    ? Number(geometry.startAngle)
    : Math.atan2(start.y - centre.y, start.x - centre.x);

  const endAngle = Number.isFinite(Number(geometry.endAngle))
    ? Number(geometry.endAngle)
    : Math.atan2(end.y - centre.y, end.x - centre.x);

  /*
   * The offset the placement asks for: how far outside (or inside) the arc the
   * dimension line sits. A placement beyond the boundary pushes the arc outwards,
   * which is the conventional look; a placement inside pulls it in, but never
   * past the centre.
   */
  const placementDistance = Math.hypot(
    dimension.placement.x - centre.x,
    dimension.placement.y - centre.y
  );

  const offsetRadius = Math.max(
    radius * 0.2,
    placementDistance
  );

  const arc = arcBetween(
    centre,
    offsetRadius,
    startAngle,
    endAngle
  );

  /*
   * THE RADII OUT TO EACH END, so the arc is visibly tied to the two ends of the
   * measured sweep rather than floating as a curve near the geometry.
   */
  const outerStart = {
    x: centre.x + Math.cos(startAngle) * offsetRadius,
    y: centre.y + Math.sin(startAngle) * offsetRadius
  };

  const outerEnd = {
    x: centre.x + Math.cos(endAngle) * offsetRadius,
    y: centre.y + Math.sin(endAngle) * offsetRadius
  };

  const midpoint = arc[Math.floor(arc.length / 2)] || outerStart;

  /*
   * THE LABEL SITS OUTSIDE THE MEASURED ARC, on the far side of the dimension
   * arc from the centre. Placed ON the arc it would be written through by the
   * arc and the arrowheads; this is the same clearance the angular dimension
   * uses, measured from the label's own size.
   */
  const radial = normalise({ x: midpoint.x - centre.x, y: midpoint.y - centre.y });
  const label = dimensionLabelSize(text, state, dimension.style);
  const textAnchor = {
    x: midpoint.x + radial.x * (label.halfHeight + label.gap),
    y: midpoint.y + radial.y * (label.halfHeight + label.gap),
  };

  return {
    kind: "arc-length",
    dimensionType: dimension.dimensionType,
    measurement,
    arc,
    extensions: [
      [centre, outerStart],
      [centre, outerEnd]
    ],
    /*
     * Arrowheads at the two ends of the measured arc, pointing along the sweep.
     * The renderer draws these directly because they are not on a straight
     * dimension line.
     */
    arrowheads: [
      {
        at: outerStart,
        direction: tangentDirection(centre, outerStart, endAngle > startAngle ? 1 : -1)
      },
      {
        at: outerEnd,
        direction: tangentDirection(centre, outerEnd, endAngle > startAngle ? -1 : 1)
      }
    ],
    text,
    label,
    textFrame: textFrame(
      textAnchor,
      { x: 1, y: 0 },
      label.fontPt,
      label,
      dimensionTextAlignment(dimension.style)
    ),
    textAnchor,
  };
}

/*
 * The points along a circular sweep, from the feature's own angles.
 *
 * Unlike `arcFrom`, the sweep is NOT clamped to a half turn: a major arc is drawn
 * as the major arc it is. The samples are taken at the centre the geometry names,
 * so an off-centre arc is drawn where it actually sits.
 */
function arcBetween(
  centre,
  radius,
  startAngle,
  endAngle
) {
  let sweep = endAngle - startAngle;

  while (sweep <= -Math.PI * 2) sweep += Math.PI * 2;
  while (sweep > Math.PI * 2) sweep -= Math.PI * 2;

  const steps = 32;
  const points = [];

  for (let index = 0; index <= steps; index += 1) {
    const angle = startAngle + (sweep * index) / steps;

    points.push({
      x: centre.x + Math.cos(angle) * radius,
      y: centre.y + Math.sin(angle) * radius
    });
  }

  return points;
}

/*
 * The unit tangent at a point on a circle, for an arrowhead.
 *
 * The tangent is perpendicular to the radius; the sign says which way along the
 * sweep the arrow points, so the two ends of an arc-length dimension point
 * outwards from the measured segment rather than both the same way.
 */
function tangentDirection(
  centre,
  point,
  sign
) {
  const radial = {
    x: point.x - centre.x,
    y: point.y - centre.y
  };

  const length = Math.hypot(radial.x, radial.y);

  if (length < 1e-9) {
    return { x: 1, y: 0 };
  }

  return {
    x: (-radial.y / length) * sign,
    y: (radial.x / length) * sign
  };
}

function radialGraphics(
  dimension,
  state,
  object,
  measurement,
  text,
  reference
) {
  /*
   * The feature is resolved from the reference actually in use.
   *
   * A Circle names its centre "center"; a support, a particle or a
   * rigid body name theirs "position". Both are legitimate sources
   * for a radial dimension, so both are tried - and the feature is
   * looked up here rather than relying on the caller having found
   * it, because a radius drawn from a property reference and a
   * radius drawn from an anchor reference reach here by different
   * routes.
   */
  const measured =
    object ||
    findObject(state, reference?.featureId);

  if (!measured) {
    return null;
  }


  /*
   * OR THE MIDPOINT OF ITS OWN CENTRELINE.
   *
   * A shaft has no "center" or "position" anchor - it is a start and an
   * end - so the lookup above found nothing and every diameter drawn
   * against one returned nothing at all. A feature with a centreline has
   * an unambiguous centre, and that is exactly what the midpoint is.
   */
  const centreline =
    enggMeasurement.twoPointSpan(
      measured
    );

  const centre =
    enggMeasurement.resolveAnchor(
      measured,
      "center"
    ) ||
    enggMeasurement.resolveAnchor(
      measured,
      "position"
    ) ||
    (centreline
      ? {
          x:
            (centreline.start.x +
              centreline.end.x) /
            2,
          y:
            (centreline.start.y +
              centreline.end.y) /
            2
        }
      : null);

  const radius = featureRadius(measured);

  if (radius === null) {
    return null;
  }

  /*
   * The radius is drawn towards the user's placement, so the student
   * chooses the angle the leader sits at - which is how a radius is
   * kept clear of the rest of the drawing.
   */
  const toPlacement = {
    x: dimension.placement.x - centre.x,
    y: dimension.placement.y - centre.y,
  };

  const direction = normalise(
    Math.hypot(toPlacement.x, toPlacement.y) > 1e-9
      ? toPlacement
      : { x: 1, y: 0 }
  );

  const diameter = dimension.dimensionType === "diameter";

  /*
   * ========================================================
   * THE POINT ON THE CIRCUMFERENCE THE DIMENSION IS DRAWN ALONG
   * ========================================================
   *
   * THE PLACEMENT NAMES A DIRECTION, NOT A DISTANCE. A radial dimension starts
   * at the centre, so a student almost always places it ON the feature; taking
   * that placement as the head's position would make the head's reach depend on
   * how far from the centre they happened to click. The direction it names is
   * what they chose; the distance is the feature's own radius.
   */
  const edge = {
    x: centre.x + direction.x * radius,
    y: centre.y + direction.y * radius,
  };

  /*
   * THE OPPOSITE CROSSING OF THE CIRCUMFERENCE. A diameter's line runs from
   * here THROUGH the centre to `edge`, which is what makes it read as a
   * diameter; a radius has no far end beyond the centre it starts from.
   */
  const far = {
    x: centre.x - direction.x * radius,
    y: centre.y - direction.y * radius,
  };

  /* The two ends of the line that is DRAWN: through the body, or centre to surface. */
  const start = diameter ? far : centre;
  const end = edge;

  /*
   * ========================================================
   * THE LEADER AND ITS ARROW
   * ========================================================
   *
   * A RADIUS IS DRAWN AS A LEADER: an arrow at the point where it meets the
   * circumference, pointing INTO the surface, a short radial run outward and a
   * horizontal shoulder carrying the text. A DIAMETER IS DRAWN THROUGH the
   * circle with a head at each end on the circumference, pointing outward at
   * the surface - the heads sit ON the circle, which is where the measurement
   * starts and ends.
   *
   * The placement decides where the leader turns and where its text stands, so
   * the student can keep a radius clear of the rest of the drawing; the head
   * and the arc it touches never move, because they are derived from the
   * feature's own centre and radius.
   */
  const label = dimensionLabelSize(text, state, dimension.style);

  /*
   * THE LEADER'S SHOULDER, AT THE PLACEMENT'S OWN RADIUS.
   *
   * The label stands just outside the circle along the placement's direction, on
   * a shoulder that runs LEVEL with the text - which is how a radius label is
   * written on a drawing. The radial run starts a small way clear of the surface
   * and the shoulder runs outwards from it, never back through the body.
   */
  const side = direction.x >= 0 ? 1 : -1;

  const radialReach = radius + label.gap * 2;

  const outwardPoint = {
    x: centre.x + direction.x * radialReach,
    y: centre.y + direction.y * radialReach,
  };

  const shoulder = { x: outwardPoint.x + side * label.gap * 2, y: outwardPoint.y };

  const textAnchor = {
    x: shoulder.x + side * (label.halfWidth + label.gap),
    y: shoulder.y,
  };

  /*
   * THE HEADS.
   *
   * A RADIUS has one, at the surface, pointing OUT through it - the direction
   * the measurement runs. A DIAMETER has one at each crossing, each pointing
   * OUT at the arc it touches, so the line reads as a measurement ACROSS the
   * body rather than a single arrow aimed at it.
   */
  const arrowheads = diameter
    ? [
        { at: far, direction: { x: -direction.x, y: -direction.y } },
        { at: edge, direction },
      ]
    : [{ at: edge, direction }];

  return {
    kind: "radial",
    dimensionType: dimension.dimensionType,
    measurement,
    centre,
    edge,
    far,
    label,
    line: [start, end],
    arrowheads,
    shoulder,
    /*
     * ARROWS FIT INSIDE A BIG ENOUGH DIAMETER, OUTSIDE A SMALL ONE.
     *
     * `decideArrowStyle` compares the drawn span with the space the document's
     * heads need, so a small circle's diameter is stated with outside arrows
     * while a large one keeps them inside.
     */
    arrowStyle:
      dimension.dimensionType === "diameter"
        ? decideArrowStyle(start, end, Math.hypot(toPlacement.x, toPlacement.y), dimension.style)
        : "outside",
    /*
     * A RADIUS'S LEADER RUNS FROM ITS SURFACE OUT TO THE TEXT'S SHOULDER. A
     * DIAMETER'S DOES NOT: its line already crosses the circle, and a second
     * line from the circumference to a far placement would read as a leader to
     * something else.
     */
    leader: diameter ? null : { from: outwardPoint, to: shoulder },
    text,
    textFrame: textFrame(textAnchor, { x: 1, y: 0 }, label.fontPt, label, dimensionTextAlignment(dimension.style)),
    textAnchor,
  };
}

function angularGraphics(
  dimension,
  state,
  measurement,
  text
) {
  const references = dimension.sourceRefs || [];

  if (references.length < 2) {
    return null;
  }

  /*
   * EACH REFERENCE RESOLVES ITS OWN SPAN - the same helper `measureAngle`
   * uses - so an arc drawn between two EDGES of one triangle is built from
   * those two edges and not from the triangle's overall span. If this and the
   * measurement disagreed, the arc and the number printed on it would state
   * different angles.
   */
  const spanA = spanOfReference(state, references[0]);
  const spanB = spanOfReference(state, references[1]);

  if (!spanA || !spanB) {
    return null;
  }

  /*
   * An angle is measured about the vertex where the two spans meet.
   * When they do not meet exactly - which is the common case, since
   * they were drawn independently - the vertex is placed on the
   * first span, nearest its end, which is where the reader will look
   * for it.
   */
  const vertex = nearestVertex(spanA, spanB);

  /*
   * THE SAME LEGS THE VALUE WAS MEASURED FROM.
   *
   * `angleSectorLegs` is the one place the angular sector is decided, so
   * the arc drawn here and the number printed above it come from the same
   * choice and cannot state different angles. When it cannot decide - no
   * placement yet, or degenerate geometry - the geometric legs are used,
   * which is the behaviour a dimension had before the cursor could choose.
   */
  const chosen = angleSectorLegs(
    vertex,
    spanA,
    spanB,
    dimension.placement
  );

  const a = chosen
    ? chosen.a
    : legDirection(vertex, spanA.start, spanA.end);

  const b = chosen
    ? chosen.b
    : legDirection(vertex, spanB.start, spanB.end);

  if (!a || !b) {
    return null;
  }

  const radius = Math.max(
    Math.hypot(
      dimension.placement.x - vertex.x,
      dimension.placement.y - vertex.y
    ),
    1e-6
  );

  const rightAngle = Math.abs(a.x*b.x+a.y*b.y) <= 1e-10;
  const side=radius/Math.sqrt(2);
  const arcPoints = rightAngle ? [
    {x:vertex.x+a.x*side,y:vertex.y+a.y*side},
    {x:vertex.x+(a.x+b.x)*side,y:vertex.y+(a.y+b.y)*side},
    {x:vertex.x+b.x*side,y:vertex.y+b.y*side}
  ] : arcFrom(vertex, a, b, radius);

  const bisector = normalise({x:a.x+b.x,y:a.y+b.y});
  const label=dimensionLabelSize(text,state,dimension.style);
  const labelRadius=radius+Math.abs(bisector.x)*label.halfWidth+Math.abs(bisector.y)*label.halfHeight+label.gap/2;

  /*
   * THE ANGLE'S ARROWHEADS POINT ALONG THE ARC, into each leg.
   *
   * An angular dimension is bounded by its two legs, so its heads sit at the
   * arc's ends and point along the arc TOWARDS the legs - the same convention
   * as a linear dimension's heads pointing at its witness lines. Their
   * direction is the arc's tangent there, which is perpendicular to the leg.
   */
  /*
   * WHICH TANGENT IS THE ONE POINTING INWARD depends on which way round the
   * arc was swept, so the two candidates are built and the one that shares a
   * direction with the arc is taken. The bisector is the inward direction at
   * both ends, so it is the test: whichever tangent has the positive dot with
   * it points into the measured sector.
   */
  /*
   * THE HEADS POINT AT THE LEGS THEY MEET.
   *
   * At each end of the arc the head's tip sits ON the arc and points ALONG the
   * arc AWAY from the measured sector - out towards the leg, which is the same
   * convention a linear dimension's heads follow at their witness lines. The
   * tangent pointing away from the sector is the negative of the inward one, so
   * it is built directly rather than guessed: the inward tangent is the one
   * sharing a direction with the bisector, and the head takes its opposite.
   */
  const awayFromArcAt = (leg) => {
    const first = normalise({ x: leg.y, y: -leg.x });
    const second = normalise({ x: -leg.y, y: leg.x });

    const inward =
      first.x * bisector.x + first.y * bisector.y >= 0 ? first : second;

    return { x: -inward.x, y: -inward.y };
  };

  const arcEnds = [
    { at: arcPoints[0], direction: awayFromArcAt(a) },
    { at: arcPoints[arcPoints.length - 1], direction: awayFromArcAt(b) },
  ];

  const textAnchor = {
    x: vertex.x + bisector.x * labelRadius,
    y: vertex.y + bisector.y * labelRadius,
  };

  return {
    kind: "angular",
    rightAngle,
    dimensionType: dimension.dimensionType,
    measurement,
    vertex,
    arc: arcPoints,
    /*
     * THE LEGS AS CONSTRUCTION LINES, drawn from the vertex out past the arc -
     * the same witness convention a linear dimension uses. They are drawn DASHED
     * on the canvas and in the source, because they are reference, not
     * measurement.
     */
    extensions: [
      [vertex, { x: vertex.x + a.x * (radius + radius * 0.08), y: vertex.y + a.y * (radius + radius * 0.08) }],
      [vertex, { x: vertex.x + b.x * (radius + radius * 0.08), y: vertex.y + b.y * (radius + radius * 0.08) }],
    ],
    arrowStyle: "outside",
    /*
     * A RIGHT ANGLE IS DRAWN AS ITS SQUARE MARKER, so it needs no heads - the
     * two short lines meeting at the corner ARE the statement. Every other
     * angle carries a head at each end of its arc.
     */
    arrowheads: rightAngle ? [] : arcEnds,
    label,
    text,
    textFrame: textFrame(
      textAnchor,
      { x: 1, y: 0 },
      label.fontPt,
      label,
      dimensionTextAlignment(dimension.style)
    ),
    textAnchor,
  };
}

/*
 * The direction from the vertex along a span, pointing away from it.
 *
 * A span whose vertex is one of its own ends - which is what two spans
 * drawn to a shared corner look like - must point at the OTHER end,
 * because pointing at the vertex itself gives a vector of length zero
 * and so no direction at all.
 *
 * The end FURTHER from the vertex is chosen rather than testing for
 * coincidence, so a span that merely begins near the vertex still gives a
 * usable direction instead of being rejected outright.
 */
function legDirection(vertex, start, end) {
  const toStart = normalise({
    x: start.x - vertex.x,
    y: start.y - vertex.y,
  });

  const toEnd = normalise({
    x: end.x - vertex.x,
    y: end.y - vertex.y,
  });

  const startDistance = Math.hypot(
    start.x - vertex.x,
    start.y - vertex.y
  );

  const endDistance = Math.hypot(
    end.x - vertex.x,
    end.y - vertex.y
  );

  return endDistance >= startDistance ? toEnd : toStart;
}

/*
 * Where two independently drawn spans meet.
 *
 * THE GENUINELY NEAREST PAIR OF ENDPOINTS, not a fixed end of the
 * first span.
 *
 * It used to be `spanA.end` - "the first span is the one the user
 * selected first and its end is the point they meant". That is true
 * only when the student happened to draw both spans ending at the
 * corner. Two spans drawn FROM a shared corner - which is what two
 * legs of a triangle look like when they are drawn outward from the
 * joint - have that corner as their STARTS, and taking `spanA.end`
 * then put the vertex at the far tip of the first line, giving an
 * angle measured at a point where the two spans do not meet at all.
 *
 * The corner is a fact about the geometry, so it is found from the
 * geometry: whichever of the four possible endpoints of the two spans
 * are closest together ARE the shared vertex. That is correct whether
 * the spans meet end-to-end, start-to-start, start-to-end, or merely
 * near each other with a small gap, and it does not depend on the
 * order the endpoints happen to be stored in.
 */
function nearestVertex(spanA, spanB) {
  if (!spanA || !spanB) {
    return spanA?.end || spanA?.start || null;
  }

  // The vertex is the intersection of the two supporting lines, including
  // crossings between endpoints and intersections of extended segments.
  const dx=spanA.end.x-spanA.start.x,dy=spanA.end.y-spanA.start.y;
  const ex=spanB.end.x-spanB.start.x,ey=spanB.end.y-spanB.start.y;
  const cross=dx*ey-dy*ex;
  if (Math.abs(cross)>1e-12*Math.hypot(dx,dy)*Math.hypot(ex,ey)) {
    const t=((spanB.start.x-spanA.start.x)*ey-(spanB.start.y-spanA.start.y)*ex)/cross;
    return {x:spanA.start.x+t*dx,y:spanA.start.y+t*dy};
  }

  const pairs = [
    [spanA.start, spanB.start],
    [spanA.start, spanB.end],
    [spanA.end, spanB.start],
    [spanA.end, spanB.end],
  ];

  let best = null;
  let bestDistance = Infinity;

  for (const [a, b] of pairs) {
    if (!a || !b) {
      continue;
    }

    const gap = Math.hypot(a.x - b.x, a.y - b.y);

    if (gap < bestDistance) {
      bestDistance = gap;
      best = a;
    }
  }

  return best || spanA.end || spanA.start || null;
}

/*
 * ========================================================
 * THE TWO LEGS THE CURSOR HAS CHOSEN
 * ========================================================
 *
 * THE ONE PLACE the angular sector is decided, used by BOTH the measured
 * value and the drawn arc. That is the whole point of putting it here: a
 * label that says 35 degrees above an arc drawn through 145 degrees is the
 * failure this design exists to prevent, and the two cannot disagree when
 * there is one function and the arc is built from its own output.
 *
 * WHY THE CURSOR AND NOT THE ENDPOINT ORDER.
 * A line has an AXIS, not an arrow. The same physical line stored
 * start-to-end or end-to-start is the same line, so which of the four
 * sectors is dimensioned may not depend on how it happened to be drawn -
 * exactly as the earlier fix here established for the VALUE. The student
 * says which sector they mean by putting the dimension in it, and the
 * placement point is that statement.
 *
 * HOW IT IS DECIDED.
 * One axis of the pair is taken as a reference; the other is at an angle
 * `theta` from it, where 0 <= theta <= 180. The four sectors are bounded by
 * the four directions: the reference's two ends, and the other axis's two
 * ends. The cursor's direction from the vertex falls in exactly one of them,
 * and the two legs bounding THAT sector are what is returned. The measured
 * angle is then simply the angle between those two legs - 35 in the narrow
 * sectors, 145 in the wide ones - with no separate branch deciding which.
 *
 * Null when the geometry cannot support a vertex and two axes; the caller
 * falls back to the legs the geometry alone implies.
 */
function angleSectorLegs(vertex, spanA, spanB, placement) {
  if (!vertex || !spanA || !spanB || !placement) {
    return null;
  }

  if (
    !Number.isFinite(placement.x) ||
    !Number.isFinite(placement.y)
  ) {
    return null;
  }

  /*
   * The two AXES, each as a unit direction. An axis has no sign, so the
   * span is normalised and then treated as a line through the vertex in
   * both directions.
   */
  const axisA = legDirection(vertex, spanA.start, spanA.end);
  const axisB = legDirection(vertex, spanB.start, spanB.end);

  if (!axisA || !axisB) {
    return null;
  }

  /*
   * The four boundary rays: each axis, in both directions.
   */
  const boundaryA0 = axisA;
  const boundaryA1 = negate(axisA);
  const boundaryB0 = axisB;
  const boundaryB1 = negate(axisB);

  /*
   * The cursor's direction from the vertex. A cursor exactly ON the vertex
   * has no direction, so there is no sector to choose and the geometry's
   * own legs are used.
   *
   * THE ZERO CASE IS TESTED HERE rather than left to `normalise`, because
   * `normalise` answers a zero vector with a fallback of the +X axis - a
   * real direction, but one the student never pointed at. Left to that
   * fallback, a placement on the vertex would silently pick whichever sector
   * contains due east. Testing the distance first is what makes "no
   * direction" mean no sector.
   */
  const toCursorRaw = {
    x: placement.x - vertex.x,
    y: placement.y - vertex.y,
  };

  if (Math.hypot(toCursorRaw.x, toCursorRaw.y) < 1e-9) {
    return null;
  }

  const toCursor = normalise(toCursorRaw);

  if (!toCursor) {
    return null;
  }

  /*
   * THE FOUR SECTORS ARE THE FOUR CONSECUTIVE PAIRS AROUND THE CIRCLE.
   *
   * The four boundary rays are the two axes in both directions. SORTING them
   * by angle and pairing each with the next divides the circle into exactly
   * the four regions, in order - which is the part that has to be right.
   *
   * THIS WAS THE BUG. The sectors used to be listed in a FIXED order -
   * (A0,B0), (B0,A1), (A1,B1), (B1,A0) - which is only the order around the
   * circle when the two axes happen to lie in a particular arrangement. When
   * they did not, the list was out of sequence and the "short way round" test
   * matched the WRONG sector: a dimension inside the 90-degree corner of a
   * triangle measured the 143-degree one outside it. Sorting removes every
   * assumption about how the two axes relate, so the same code is correct for
   * any pair of lines at any angle.
   */
  const boundaries = anglesOf([boundaryA0, boundaryA1, boundaryB0, boundaryB1]);

  const sectors = boundaries.map((entry, index) => {
    const next = boundaries[(index + 1) % boundaries.length];

    return {
      a: entry.ray,
      b: next.ray,
      /*
       * THE SWEEP IS ALWAYS FORWARD, between 0 and a full turn. Taken from
       * the sorted order, the pair is a genuine slice of the circle and the
       * cursor is inside it when its angle lies between the two.
       */
      from: entry.angle,
      to: next.angle > entry.angle ? next.angle : next.angle + Math.PI * 2,
    };
  });

  const cursorAngle = atan2Angle(toCursor);

  for (const sector of sectors) {
    /*
     * The cursor's angle, brought into the sector's own turn when it lies
     * before the sector's start.
     */
    let angle = cursorAngle;

    while (angle < sector.from - 1e-9) {
      angle += Math.PI * 2;
    }

    if (angle <= sector.to + 1e-9) {
      return { a: sector.a, b: sector.b };
    }
  }

  return null;
}

/*
 * The four rays with their angles, SORTED by angle.
 *
 * The sort is what makes the sector list independent of how the two axes
 * happen to be oriented, and ATAN2 OF THE RAY is the angle to sort by - a full
 * turn from +X, so two rays that point the same way would sort together and
 * the degenerate case never arises (two axes are never parallel here; parallel
 * references are a distance, handled before this is reached).
 */
function anglesOf(rays) {
  return rays
    .map((ray) => ({ ray, angle: atan2Angle(ray) }))
    .sort((first, second) => first.angle - second.angle);
}

/* The angle of a unit ray, in [0, 2*PI). */
function atan2Angle(ray) {
  let angle = Math.atan2(ray.y, ray.x);

  if (angle < 0) {
    angle += Math.PI * 2;
  }

  return angle;
}

function negate(vector) {
  return { x: -vector.x, y: -vector.y };
}

function arcFrom(centre, from, to, radius) {  const startAngle = Math.atan2(from.y, from.x);
  const endAngle = Math.atan2(to.y, to.x);

  let sweep = endAngle - startAngle;

  while (sweep <= -Math.PI) sweep += 2 * Math.PI;
  while (sweep > Math.PI) sweep -= 2 * Math.PI;

  const steps = 24;
  const points = [];

  for (let index = 0; index <= steps; index += 1) {
    const angle = startAngle + (sweep * index) / steps;

    points.push({
      x: centre.x + Math.cos(angle) * radius,
      y: centre.y + Math.sin(angle) * radius,
    });
  }

  return points;
}

const enggDimensionModel = {
  DEFAULT_PRECISION,
  ORIENTATIONS,
  REFERENCE_KINDS,


  alreadyStated,
  createDimension,
  describesSameAs,
  dimensionDirection,
  featureRadius,
  findObject,
  formatMeasurement,
  graphicsFor,
  isResolved,
  WITNESS_STANDOFF_MM,
  WITNESS_OVERSHOOT_MM,
  measurePoints,
  measurementFor,
  newDimensionId,
  normaliseReferences,
  resolvePrecision,
  round,
};

export default enggDimensionModel;

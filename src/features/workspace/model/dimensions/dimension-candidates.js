/*
 * ========================================================
 * DIMENSION CANDIDATES: WHAT A SELECTION CAN BE MEASURED AS
 * ========================================================
 *
 * The Dimension tool is ONE tool. Part of what makes it usable with a single
 * button is that it does not ask the student to name the measurement before
 * they have picked anything: it asks the selection, through this module, what
 * measurements that selection supports - and gets back complete DESCRIPTORS,
 * each of which already carries the references the measurement is taken from.
 *
 *     descriptorsFor(objects, state)   the measurements a selection offers
 *
 * WHY THIS IS A MODULE OF ITS OWN
 * -------------------------------
 * This is the inference half of the retired Smart Dimension tool. That TOOL is
 * gone - there is no smart-dimension id, no manifest and no handler - but the
 * judgement it contained is what makes Dimension work at all, so it lives here
 * as the dimension model's own candidate builder and the single Dimension tool
 * asks it. Keeping it beside the dimension model, rather than in a tool file
 * named after a tool that no longer exists, is the difference between removing
 * a retired tool and deleting a current feature's internals.
 *
 * WHAT IT WILL NOT DO
 * -------------------
 * It will not produce more dimensions than the drawing needs. A rectangle is not
 * given a width, a height, a diagonal and two corner-to-centre distances; a beam
 * is not given its span, its depth and both of those again. Over-dimensioning is
 * a real defect in an engineering drawing, so preferring one good measurement to
 * several complete ones is the correct behaviour.
 *
 * It also will not calculate anything. Every candidate is a measurement of
 * geometry that is already there. There is no inference of a reaction, an
 * equilibrium or a resultant anywhere in this file.
 */
import enggMeasurement from "../../../../shared/geometry/measurement-core.js";
import enggDimensionModel from "./dimension-model.js";

/*
 * How many measurements one feature is worth describing.
 *
 * One, except for the two cases where a reader genuinely needs both numbers to
 * use the drawing - a rectangle's width and height, a shaft's length and
 * diameter. Those are listed explicitly below rather than allowed to happen, so
 * "one unless it is one of these" is a rule that can be read rather than a
 * tendency to be observed.
 */
const DEFAULT_MEASUREMENT_COUNT = 1;

const TWO_MEASUREMENT_TYPES = {
  rectangle: ["horizontal", "vertical"],
  "rigid-body": ["horizontal", "vertical"],
  shaft: ["linear", "diameter"],
  truss: ["horizontal", "vertical"],
};

/*
 * ========================================================
 * ONE FEATURE
 * ========================================================
 */

/*
 * What should be measured for a single feature.
 *
 * Returns a LIST, because the answer is sometimes more than one measurement -
 * but a short list, in preference order, not every possibility. The list is what
 * the caller may offer; it is not permission to place them all.
 */
function candidatesFor(object) {
  if (!object) {
    return [];
  }

  const preferred = TWO_MEASUREMENT_TYPES[object.type];

  if (preferred) {
    return preferred.filter((type) => isAvailable(object, type));
  }

  /*
   * Everything else is measured by its most useful measurement, which the
   * capability layer already ranks: a circle leads with its diameter because the
   * capability says so, and a beam leads with its horizontal span for the same
   * reason.
   */
  const supported = enggMeasurement.dimensionCandidates(object);

  if (!supported.length) {
    return [];
  }

  /*
   * A feature that has a stored circular value of its own gets that as well as
   * its lead measurement - and only if it really has one, so nothing is offered
   * that the feature cannot answer.
   */
  const own = ["diameter", "radius"].find(
    (type) => supported.includes(type) && circularValueOf(object, type),
  );

  return own ? [supported[0], own] : [supported[0]];
}

/*
 * Whether a feature can support a particular measurement at all.
 *
 * A rectangle lists a width and a height; a CIRCLE does not, and offering it one
 * would produce a dimension of nothing. This is the guard that stops a
 * preference list being taken as a promise.
 */
function isAvailable(object, dimensionType) {
  return enggMeasurement.dimensionCandidates(object).includes(dimensionType);
}

/*
 * ========================================================
 * TWO FEATURES
 * ========================================================
 */

/*
 * What should be measured BETWEEN two features.
 *
 * The interesting cases are not symmetric, so they are named rather than
 * derived:
 *
 *   two spans        the included angle between them, when they are not
 *                    parallel - which is the thing a student selecting two
 *                    members usually wants
 *   two circular     centre to centre, not the gap between their edges: two
 *                    circles are located by their centres
 *   a point and a    the distance between them
 *   span
 */
function pairCandidates(first, second) {
  if (!first || !second) {
    return [];
  }

  const firstSpan = enggMeasurement.twoPointSpan(first);
  const secondSpan = enggMeasurement.twoPointSpan(second);

  /*
   * Two spans that are not parallel: the angle between them is the measurement a
   * reader is looking for, and it is the one thing that cannot be stated by
   * dimensioning either of them alone.
   *
   * Parallel spans are excluded, because an included angle of zero or 180
   * degrees says nothing.
   */
  if (firstSpan && secondSpan) {
    const angle = includedAngle(firstSpan, secondSpan);

    if (angle !== null && angle > 0.05 && angle < 179.95) {
      return ["angular"];
    }
  }

  return enggMeasurement.pairCandidates(first, second).slice(0, 1);
}

/*
 * The angle two spans make, in degrees.
 *
 * The angle between their directions, which is what an engineering angle
 * dimension states. Null when either span is degenerate - a zero-length member
 * has no direction, and an angle to nothing is not zero, it is unanswerable.
 */
function includedAngle(first, second) {
  const a = directionOf(first);
  const b = directionOf(second);

  if (!a || !b) {
    return null;
  }

  const dot = a.x * b.x + a.y * b.y;

  const determinant = a.x * b.y - a.y * b.x;

  const degrees = (Math.atan2(determinant, dot) * 180) / Math.PI;

  return Math.abs(degrees);
}

function directionOf(span) {
  if (!span?.start || !span?.end) {
    return null;
  }

  const deltaX = span.end.x - span.start.x;
  const deltaY = span.end.y - span.start.y;

  const length = Math.hypot(deltaX, deltaY);

  /*
   * A member of no length has no direction. A truss drawn with two coincident
   * joints is a real state - a student mid-edit - and treating it as horizontal
   * would produce a 0 degree dimension asserting something false.
   */
  if (length < 1e-9) {
    return null;
  }

  return { x: deltaX / length, y: deltaY / length };
}

/*
 * ========================================================
 * REDUNDANCY
 * ========================================================
 */

/*
 * Which of these measurements is not already on the drawing.
 *
 *   REDUNDANT    the same measurement of the same feature. Two dimensions both
 *                saying "this beam is 4000 long" is not more information.
 *
 *   NOT          a DIFFERENT measurement of the same feature. A beam's span and
 *   REDUNDANT    its depth are different facts, and a drawing that states both
 *                is correctly dimensioned.
 *
 * So this compares the measurement itself - type, source, anchors - and not the
 * feature, because "already has a dimension" is the wrong test and would
 * suppress useful dimensions.
 */
function withoutRedundancy(candidates, state) {
  return candidates.filter(
    (candidate) => !enggDimensionModel.alreadyStated(candidate, state),
  );
}

/*
 * ========================================================
 * SELECTION
 * ========================================================
 */

/*
 * The measurements a selection offers.
 *
 *   objects   the selected features, in selection order
 *   state     the document, for the redundancy check
 *
 * Returns dimension descriptors - the same shape createDimension takes - rather
 * than creating anything. Deciding and creating are separate because the tool
 * has to show the student what it detected BEFORE it commits, and a decision
 * that had already created a feature could not be previewed or declined.
 *
 * Placement is left unset: where the dimension sits is the student's next
 * choice, made with the mouse.
 */
function descriptorsFor(objects, state) {
  const selected = (objects || []).filter(
    (object) =>
      object && object.type !== "dimension" && object.type !== "annotation",
  );

  if (!selected.length) {
    return [];
  }

  /*
   * Dimensions and annotations are excluded above, and it matters that they
   * are: measuring a dimension would produce a dimension of a dimension, which
   * is how a drawing ends up with numbers measuring numbers.
   */
  if (selected.length === 1) {
    return describe(selected[0], candidatesFor(selected[0]), state);
  }

  if (selected.length === 2) {
    return describePair(selected[0], selected[1], state);
  }

  /*
   * Three or more: each feature is measured independently rather than as a
   * collection. A selection of six beams is six spans, not fifteen pairwise
   * distances.
   */
  return selected.flatMap((object) =>
    describe(object, candidatesFor(object), state),
  );
}

/*
 * One feature, its candidates, minus anything already stated.
 *
 * Limited to what the feature is worth describing, which is the count from the
 * type's entry rather than a flat one-per-feature.
 */
function describe(object, candidates, state) {
  const allowed = TWO_MEASUREMENT_TYPES[object.type]
    ? 2
    : DEFAULT_MEASUREMENT_COUNT;

  /*
   * The limit is applied to what is PLACED rather than to what was considered:
   * capping the candidate list took the first N candidates, so a feature whose
   * list was reordered could come out with more measurements than the limit
   * allows.
   */
  const placed = [];

  for (const candidate of candidates) {
    if (placed.length >= allowed) {
      break;
    }

    const descriptor = descriptorFor(object, candidate, state);

    if (!descriptor) {
      continue;
    }

    if (enggDimensionModel.alreadyStated(descriptor, state)) {
      continue;
    }

    placed.push(descriptor);
  }

  return placed;
}

/*
 * Two features, measured against each other.
 *
 * A pair produces ONE measurement, never one per feature. A student who selected
 * two beams to find the angle between them did not ask for each beam's span as
 * well.
 */
function describePair(first, second, state) {
  const candidates = pairCandidates(first, second);

  return withoutRedundancy(
    candidates.slice(0, DEFAULT_MEASUREMENT_COUNT),
    state,
  )
    .map((candidate) => pairDescriptorFor(first, second, candidate, state))
    .filter(Boolean);
}

/*
 * A descriptor for a measurement of one feature.
 *
 * The anchors are chosen from the feature's own, and the pair is the one the
 * measurement type needs: two anchors for a length, one for a radius or a
 * coordinate, and the feature's own diameter field for a shaft - because a
 * shaft's diameter is a value it stores, not a distance between two of its
 * points.
 */
function descriptorFor(object, dimensionType, _state) {
  const anchors = enggMeasurement.anchorOptions(object);

  if (dimensionType === "diameter" || dimensionType === "radius") {
    const ownDiameter = circularValueOf(object, dimensionType);

    if (ownDiameter) {
      return {
        dimensionType,
        refs: [
          {
            kind: "property",
            featureId: object.id,
            property: ownDiameter,
          },
        ],
        sourceType: object.type,
      };
    }
  }

  if (anchors.length < 2) {
    /*
     * A single-anchor measurement needs only the one point, and offering a
     * second would be measuring from a point to itself.
     */
    if (anchors.length !== 1) {
      return null;
    }

    return {
      dimensionType,
      refs: [
        {
          kind: "at",
          featureId: object.id,
          anchor: anchors[0],
        },
      ],
      sourceType: object.type,
    };
  }

  /*
   * Two anchors, and which two depends on what is being measured: a circle's
   * east and west are its diameter, and mixing the first two anchors the
   * capability happens to list would measure a chord.
   */
  const pair = anchorPairFor(object, dimensionType, anchors);

  if (!pair) {
    return null;
  }

  return {
    dimensionType,
    refs: [
      {
        kind: "between",
        featureId: object.id,
        anchor: pair[0],
      },
      {
        kind: "between",
        featureId: object.id,
        anchor: pair[1],
      },
    ],
    sourceType: object.type,
  };
}

/*
 * Which two anchors a measurement should be taken between.
 *
 * A circle's opposing edges are its real diameter, and a beam's two ends are its
 * real span - so the pair is chosen to match what the measurement means rather
 * than by taking the first two names the feature happens to list.
 */
function anchorPairFor(object, dimensionType, anchors) {
  if (dimensionType === "diameter") {
    const across = ["east", "west", "north", "south"].filter((name) =>
      anchors.includes(name),
    );

    if (across.length >= 2) {
      return [across[0], across[1]];
    }

    /*
     * NOT a diameter, and nothing may be offered in its place: taking a
     * polygon's first and last vertices and calling the distance between them
     * its diameter would print a chord beside a diameter symbol.
     */
    return null;
  }

  if (dimensionType === "radius") {
    const edge = ["east", "north", "west", "south", "start", "end"].find(
      (name) => anchors.includes(name),
    );

    const centre = ["center", "position"].find((name) =>
      anchors.includes(name),
    );

    if (edge && centre) {
      return [centre, edge];
    }

    /*
     * As above: a feature with neither a centre nor an edge has no radius to
     * state. The edge may be a cardinal point OR one end of an arc's sweep,
     * because an arc's centre and its start point ARE a radius.
     */
    return null;
  }

  /*
   * For a linear measurement the extremes are the answer. Naming order is an
   * implementation detail and cannot be what decides which points are the ends -
   * a span also publishes derived points (midpoint, quarters), and pairing
   * first-with-last paired start with a quarter and printed three quarters of
   * the length as the whole of it.
   */
  return widestPair(object, anchors);
}

/*
 * The two anchors furthest apart.
 *
 * Solved by brute force over the feature's own anchors rather than by a rule per
 * shape, because the rule would have to be rewritten for every feature type that
 * ever has more than two.
 */
function widestPair(object, anchors) {
  if (anchors.length < 2) {
    return null;
  }

  let best = null;
  let bestDistance = -1;

  const points = anchors
    .map((name) => ({
      name,
      point: enggMeasurement.resolveAnchor(object, name),
    }))
    .filter((entry) => entry.point);

  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) {
      const distance = Math.hypot(
        points[j].point.x - points[i].point.x,
        points[j].point.y - points[i].point.y,
      );

      if (distance > bestDistance) {
        bestDistance = distance;
        best = [points[i].name, points[j].name];
      }
    }
  }

  return best;
}

/*
 * A feature's own circular value, where it has one.
 *
 * A shaft stores a DIAMETER; a circle and an arc store a radius. A measurement
 * of a stored value is the real one - the exterior of the feature, not a
 * distance between two of its points.
 */
function circularValueOf(object, dimensionType) {
  const geometry = object.geometry || {};

  if (
    dimensionType === "diameter" &&
    Number.isFinite(Number(geometry.diameter))
  ) {
    return "diameter";
  }

  /*
   * A circle's radius can be read from its stored value, but only when the
   * feature genuinely has one. For a circle, whose anchors already include its
   * edges, the anchor form is equivalent and keeps the two routes from
   * disagreeing.
   */
  if (dimensionType === "radius" && object.type === "shaft") {
    return Number.isFinite(Number(geometry.radius)) ? "radius" : null;
  }

  return null;
}

/*
 * A descriptor for a measurement between two features.
 *
 * Both references name one anchor on one feature each, which is what makes the
 * pair associative: moving either feature moves the measurement, because the
 * dimension reads both positions afresh rather than storing the distance between
 * them.
 */
function pairDescriptorFor(first, second, dimensionType, _state) {
  if (dimensionType === "angular") {
    return {
      dimensionType,
      refs: [
        {
          kind: "between",
          featureId: first.id,
          anchor: spanAnchor(first),
        },
        {
          kind: "between",
          featureId: second.id,
          anchor: spanAnchor(second),
        },
      ],
      sourceType: "pair",
    };
  }

  const firstPoint = pairPointOf(first);
  const secondPoint = pairPointOf(second);

  if (!firstPoint || !secondPoint) {
    return null;
  }

  return {
    dimensionType,
    refs: [
      {
        kind: "between",
        featureId: firstPoint.featureId,
        anchor: firstPoint.anchor,
      },
      {
        kind: "between",
        featureId: secondPoint.featureId,
        anchor: secondPoint.anchor,
      },
    ],
    sourceType: "pair",
  };
}

/*
 * The anchor a feature is located by when measured against another.
 *
 * A span is located by its end, because a dimension between two members is read
 * at the joint they share - measuring centre to centre instead would state a
 * different number from the one the reader will check.
 */
function spanAnchor(object) {
  const span = enggMeasurement.twoPointSpan(object);

  return span ? "end" : "position";
}

/*
 * Where a feature is, for a distance between two of them.
 */
function pairPointOf(object) {
  const span = enggMeasurement.twoPointSpan(object);

  if (span) {
    return {
      featureId: object.id,
      anchor: "start",
    };
  }

  const anchor = ["position", "center", "east"].find((name) =>
    enggMeasurement.anchorResolves(object, name),
  );

  return anchor ? { featureId: object.id, anchor } : null;
}

const enggDimensionCandidates = {
  descriptorsFor,
  describe,
  describePair,
  DEFAULT_MEASUREMENT_COUNT,
  TWO_MEASUREMENT_TYPES,
  candidatesFor,
  descriptorFor,
  includedAngle,
  isAvailable,
  pairCandidates,
  withoutRedundancy,
};

export default enggDimensionCandidates;

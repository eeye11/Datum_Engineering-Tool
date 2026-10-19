/*
 * ============================================================
 * CREATION-TIME DIMENSIONING
 * ============================================================
 *
 * The shared framework that lets ANY feature ask for its
 * physical size the moment it is created, and that lets the FIRST
 * such answer establish the document's engineering scale.
 *
 * ONE FRAMEWORK, NOT ONE PER TOOL
 * -------------------------------
 * A Beam, a Circle and a Rectangle are different shapes, but
 * asking for a size is the same act every time. So the popup, the
 * unit handling, the validation, the conversion and the
 * calibration rule all live here, and a tool supplies only the
 * one thing that is genuinely particular to it: WHICH dimensions
 * its geometry has, and what each one means.
 *
 * THE THREE THINGS THIS MODULE DECIDES
 * ------------------------------------
 *
 *   1. WHICH FEATURES HAVE A CREATION SIZE AT ALL.
 *      A Beam is a length. A Support is not, and a Point Force's
 *      meaningful quantities are a magnitude and a direction -
 *      none of which is a length. Asking a student for the
 *      "length" of a support would be asking them to invent a
 *      number that means nothing, so those features are
 *      classified out and never enter the workflow.
 *
 *   2. WHAT THOSE DIMENSIONS ARE, IN ENGINEERING TERMS.
 *      A Circle is asked for its Diameter, not its "X extent". A
 *      Rectangle is asked for its Width and its Height. The
 *      vocabulary is the one the drawing uses, so the popup and
 *      the Features panel name the same quantity the same way.
 *
 *   3. HOW A TYPED ENGINEERING VALUE BECOMES GEOMETRY.
 *      The value is converted through the ONE document scale
 *      (enggDimensions) into world units, and then applied by the
 *      SAME property setter the Features panel uses. There is no
 *      second conversion and no second setter, so the popup, the
 *      panel and a later Smart Dimension cannot disagree.
 *
 * THE CALIBRATION RULE
 * --------------------
 * The document has one engineering length scale, and it is
 * established exactly once:
 *
 *   FIRST creation dimension in an uncalibrated document
 *       -> establishes the scale, from the drawn geometry
 *   EVERY LATER creation dimension
 *       -> edits that feature's geometry using the scale
 *
 * A two-value shape obeys the same rule across its two fields:
 * the first value calibrates, the second is read against the
 * scale the first just established. Neither field ever creates a
 * second global scale.
 */
import enggFeatureGeometry from "../../../../shared/geometry/feature-geometry.js";
import enggDimensions from "../../../../shared/scale/dimensions.js";
import enggQuantities from "../../../../shared/units/quantities.js";

/*
 * ========================================================
 * THE FEATURE CLASSIFICATION
 * ========================================================
 *
 * Which features are asked for a creation size, and which
 * dimensions each one is asked for. This is the single
 * authoritative list; a tool does not describe its own popup,
 * it is described here, so two tools of the same shape cannot
 * drift into asking different questions.
 *
 * A definition is a list of DIMENSIONS. Each dimension names:
 *
 *   key        the geometry property the value is applied to,
 *              by the same name the Features panel uses
 *   label      what the student is asked for
 *   measure    how the CURRENT world value is read from the
 *              geometry, for the suggested starting value
 *
 * The order is the order they are asked in.
 *
 * A feature absent from this list is CATEGORY D: it has no
 * meaningful creation length, and no popup is shown for it.
 * That is the deliberate default - a new feature type is
 * silent until somebody says what its size means, rather than
 * inheriting a meaningless "Length" question.
 */
const DEFINITIONS = {
  /*
   * A Line is one length between two points. Its direction is
   * fixed by the two clicks and is not asked for again.
   */
  line: [
    {
      key: "length",
      label: "Length",
      measure: spanLength,
    },
  ],

  /*
   * A Reference Line is a Line in the construction style, so it
   * asks the same question with the same meaning.
   */
  "reference-line": [
    {
      key: "length",
      label: "Length",
      measure: spanLength,
    },
  ],

  /*
   * The slender members. Each is a span between two ends, so
   * each is asked for its Length - one quantity, one popup. A
   * Truss is a structure, but its meaningful creation size is
   * still its overall span.
   */
  beam: [
    {
      key: "length",
      label: "Beam Length",
      measure: spanLength,
    },
  ],

  truss: [
    {
      key: "length",
      label: "Truss Length",
      measure: spanLength,
    },
  ],

  cable: [
    {
      key: "length",
      label: "Cable Length",
      measure: spanLength,
    },
  ],

  shaft: [
    {
      key: "length",
      label: "Shaft Length",
      measure: spanLength,
    },
  ],

  /*
   * A Circle has one meaningful dimension. DAETUM dimensions a
   * circle by its Diameter, so the creation popup asks the same
   * - one quantity, and it is the one the drawing already uses.
   */
  circle: [
    {
      key: "diameter",
      label: "Diameter",
      measure: (geometry) => 2 * Number(geometry?.radius),
    },
  ],

  /*
   * A Rectangle has two independent dimensions, and both are
   * needed to describe it. They are asked in engineering terms -
   * Width and Height - never as "X length" and "Y length".
   */
  rectangle: [
    {
      key: "width",
      label: "Width",
      measure: (geometry) => Number(geometry?.width),
    },
    {
      key: "height",
      label: "Height",
      measure: (geometry) => Number(geometry?.height),
    },
  ],

  /*
   * An Arc is NOT given two arbitrary lengths. Its defining
   * circular quantity is its Radius; the angles that bound it
   * are angles, not lengths, and are not part of a length
   * popup. Asking only for the Radius keeps the three-point arc
   * workflow intact: the arc still passes through the points
   * the student clicked, and the radius is the one number that
   * says how big the curve is.
   */
  arc: [
    {
      key: "radius",
      label: "Radius",
      measure: (geometry) => Number(geometry?.radius),
    },
  ],

  /*
   * A REFERENCE ARC IS A TRUE ARC.
   *
   * Its only difference from an Arc is that it is drawn in the
   * construction style, so it is asked the same question with the same
   * meaning - the same three points define the same circumcircle and
   * the same Radius says how big it is. Leaving it out of this table
   * did not make it "not an arc"; it made the tool silently skip its
   * creation popup while its Features panel still offered an editable
   * Radius, so the two routes to the same value disagreed.
   */
  "reference-arc": [
    {
      key: "radius",
      label: "Radius",
      measure: (geometry) => Number(geometry?.radius),
    },
  ],
};

/*
 * A Rigid Body's dimensions depend on the shape it currently
 * has, so its definition is chosen at ask time rather than
 * stored in the table above. Only the dimensions that apply to
 * the CURRENT shape are ever offered - a circle body is not
 * asked for a Width and a Height it does not have.
 */
function rigidBodyDimensions(geometry) {
  const shape =
    enggFeatureGeometry?.rigidBodyShape?.(geometry) || "rectangle";

  if (shape === "circle") {
    /*
     * A rigid-body circle is measured from its centre outwards, and
     * the Features panel offers exactly one SIZE row for it: Radius,
     * written through the `rigidRadius` property. The creation popup
     * asks the same quantity under the same key, so the value the
     * student confirms and the value the panel later shows are ONE
     * property rather than two that can disagree.
     */
    return [
      {
        key: "rigidRadius",
        label: "Radius",
        measure: (g) =>
          Number(g?.radius) ||
          Math.max(
            Number(g?.width) || 0,
            Number(g?.height) || 0,
          ) / 2,
      },
    ];
  }

  if (shape === "triangle" || shape === "polygon") {
    /*
     * A point-defined shape has no independent width and
     * height; its size is its extent. Offering one dimension -
     * the width of its bounding box - would be inventing a
     * parameter the shape does not store. Those shapes are left
     * without a creation popup rather than given a wrong one.
     */
    return [];
  }

  return [
    {
      key: "rigidWidth",
      label: "Width",
      measure: (g) => Number(g?.width),
    },
    {
      key: "rigidHeight",
      label: "Height",
      measure: (g) => Number(g?.height),
    },
  ];
}

/*
 * ========================================================
 * WHAT TO ASK FOR A FEATURE
 * ========================================================
 *
 * Returns the fields to ask, with a suggested engineering
 * value for each, or null when the feature has no creation
 * size.
 *
 * The suggestion is the CURRENT drawn size, converted through
 * the document scale. For a calibrated document that is a real
 * engineering value the student can accept unchanged. For an
 * uncalibrated document there is no honest conversion, so the
 * drawn value is offered as millimetres - which is the
 * one-to-one assumption the rest of the application already
 * makes, and which the student's answer will confirm or
 * replace.
 */
function planFor(object, state) {
  if (!object || !object.geometry) {
    return null;
  }

  const dimensions =
    object.type === "rigid-body"
      ? rigidBodyDimensions(object.geometry)
      : DEFINITIONS[object.type];

  if (!dimensions || !dimensions.length) {
    return null;
  }

  const unit = displayUnit(state);

  const fields = [];

  for (const dimension of dimensions) {
    const worldValue = Number(dimension.measure(object.geometry));

    /*
     * A dimension that cannot be read from the geometry has no
     * honest suggestion. The field is still offered - the
     * student may know the number even if the drawing cannot
     * measure it - but it starts empty rather than pre-filled
     * with a fabricated value.
     */
    const suggestion = Number.isFinite(worldValue)
      ? worldToEngineering(state, worldValue)
      : null;

    fields.push({
      key: dimension.key,
      label: dimension.label,
      unit,
      value: suggestion,
      worldValue,
    });
  }

  return {
    title: titleFor(object.type),
    fields,
  };
}

/*
 * The heading a popup shows. It names the object being sized,
 * so the student reads "Rectangle" and knows what the question
 * is about.
 */
    function titleFor(type) {
  return (
    {
      line: "Line",
      "reference-line": "Reference Line",
      beam: "Beam",
      truss: "Truss",
      cable: "Cable",
      shaft: "Shaft",
      circle: "Circle",
      arc: "Arc",
      "reference-arc": "Reference Arc",
      rectangle: "Rectangle",
      "rigid-body": "Rigid Body",
    }[type] || "Size"
  );
}

/*
 * ========================================================
 * APPLYING A CONFIRMED VALUE
 * ========================================================
 *
 * Turn a typed engineering value into world units and apply
 * it through the caller's property setter.
 *
 * The setter is passed in rather than reached for, so this
 * module never depends on drawing.js and can be tested on its
 * own - and so the ONE property setter stays the ONE property
 * setter. `apply(object, key, worldValue)` returns true when
 * the geometry accepted the change.
 *
 * `field.unit` is the unit THE STUDENT CHOSE, and it is passed
 * through to both conversions below unchanged. That is what
 * makes "0.5 m" and "500 mm" the same physical length: each is
 * read in the unit it was typed in, and both resolve to the same
 * millimetres through the ONE scale. The document's own unit is
 * only a fallback for a field that somehow arrived without one.
 *
 * CALIBRATION, AND WHY IT IS HERE
 * -------------------------------
 * If the document has no scale yet, THIS value is what
 * establishes it. The scale is derived from the geometry the
 * student actually drew, not from the value they typed:
 *
 *     mm per world unit = typed mm / drawn world units
 *
 * which is exactly the relationship the Smart Dimension's
 * calibration uses, through the same `enggDimensions.calibrate`
 * call. `calibrate` converts the typed value to millimetres
 * itself, so a first dimension of "0.5 m" establishes the same
 * scale as "500 mm" would. After that the value is applied in
 * world units through the same conversion, so the feature ends
 * up the size the student asked for under the scale that value
 * established.
 */
/*
 * Turn a typed engineering value into the feature's authoritative
 * property.
 *
 * `apply(object, key, engineeringValue)` returns true when the
 * geometry accepted the change, and it is the caller's ONE
 * property setter - the same one the Features panel writes
 * through. That is what keeps the two routes from disagreeing.
 *
 * THE VALUE HANDED TO `apply` IS IN MILLIMETRES.
 * -------------------------------------------
 * The Features panel captions its length fields with a unit and
 * enters millimetres, so the setter accepts millimetres and does
 * the one conversion into world units. That means the number
 * crossing into the geometry has to ARRIVE in millimetres,
 * whatever unit the student typed it in.
 *
 * So a value typed as "0.5 m" becomes 500 mm here, by the factor
 * each unit declares against the millimetre, and `apply` receives
 * 500. This is a UNIT conversion only - it does not touch the
 * document scale, because the scale is not what turns metres into
 * millimetres.
 *
 * Converting through the scale as well was the bug this comment
 * exists to prevent: the value crossed the scale twice - once here
 * and once inside the setter - so a beam sized at 500 mm came out
 * five times too short and reported a fifth of the length the
 * student typed. One conversion, in one place, or the two routes
 * disagree about what a millimetre is.
 *
 * `field.unit` is the unit THE STUDENT CHOSE, and it is preserved so
 * a value typed as "0.5 m" and one typed as "500 mm" resolve to the
 * same physical length.
 */
function applyValue(object, state, field, engineeringValue, apply) {
  const value = Number(engineeringValue);

  if (!Number.isFinite(value)) {
    return false;
  }

  const unit =
    field.unit && enggQuantities?.LENGTH_UNITS?.[field.unit]
      ? field.unit
      : displayUnit(state);

  return apply(
    object,
    field.key,
    value * (enggQuantities?.LENGTH_UNITS?.[unit]?.mm ?? 1)
  ) === true;
}

/*
 * ========================================================
 * CONVERSIONS
 * ========================================================
 *
 * These are thin wrappers over the ONE scale system. They
 * exist so this module never writes its own formula: a world
 * length becomes an engineering value by asking
 * enggDimensions, and nothing else.
 */
function worldToEngineering(state, worldValue) {
  return enggDimensions.toEngineering(state, worldValue).value;
}

function displayUnit(state) {
  const scale = enggDimensions.readScale(state);

  return scale?.unit || enggDimensions.DEFAULT_UNIT || "mm";
}

/*
 * The length of a two-point span, in world units.
 *
 * A span is measured between its ends rather than by either
 * axis, so a member drawn at an angle is asked for its true
 * length. This is the same measurement the Features panel and
 * Smart Dimension read.
 */
function spanLength(geometry) {
  const start = geometry?.start;
  const end = geometry?.end;

  if (
    !start ||
    !end ||
    !Number.isFinite(start.x) ||
    !Number.isFinite(start.y) ||
    !Number.isFinite(end.x) ||
    !Number.isFinite(end.y)
  ) {
    return null;
  }

  return Math.hypot(end.x - start.x, end.y - start.y);
}

/*
 * The public surface.
 *
 * `hasCreationSize` answers the classification question for a
 * tool deciding whether to enter the workflow at all, without
 * building a plan. `planFor` answers what to ask. `applyValue`
 * is the one path by which an answer becomes geometry.
 */
const enggCreationDimensioning = {
  DEFINITIONS,
  applyValue,
  displayUnit,
  hasCreationSize(object) {
    if (!object) {
      return false;
    }

    if (object.type === "rigid-body") {
      return rigidBodyDimensions(object.geometry).length > 0;
    }

    return Array.isArray(DEFINITIONS[object.type]);
  },
  planFor,
  rigidBodyDimensions,
  spanLength,
  titleFor,
  worldToEngineering,
};

export default enggCreationDimensioning;

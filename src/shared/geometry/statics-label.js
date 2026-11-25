/*
 * ============================================================
 * WHERE A STATICS OBJECT'S TEXT SITS
 * ============================================================
 *
 * ONE ANSWER, ASKED BY EVERYTHING.
 *
 * A label on a force, a load, a moment, a support, a connection, a reference or
 * a resultant is not a separate drawing object. It is a PART of the object it
 * names - stored inside that object, selected with it, deleted with it and
 * written into its source - which is what keeps one feature one row in the
 * Objects list. Whether a label is a separate object is therefore not a choice
 * this module makes.
 *
 * What it does decide is WHERE that label is drawn, and it is the ONLY place
 * that decides it. The renderer draws the words here, the Source writer writes
 * the node here, the hit test measures its box here and the inline editor opens
 * at the point here - so the four cannot drift apart, which is exactly how a
 * label ends up in one place on the canvas and another in the source.
 *
 * THE ANCHOR IS DERIVED; THE OFFSET IS THE STUDENT'S.
 *
 *   labelAnchorOf(object)   where the label WOULD go by default, in drawing
 *                           units: the arrowhead of a force, the middle of a
 *                           load, beside a moment's arc, outside a support's
 *                           symbol.
 *   labelHomeOf(object)     that anchor plus the object's own `labelOffset`
 *                           (set by dragging the label, cleared by Reset).
 *
 * THE OFFSET IS STORED ON THE OBJECT, in drawing units, so a label keeps the
 * distance the student put it at when the drawing is zoomed, saved or written
 * to LaTeX - and follows its object when the object moves, because the anchor
 * moves and the offset does not.
 *
 * WHY THIS IS NOT IN THE RENDERER. The hit test and the source writer need the
 * same answer and neither may import the renderer (`tests/render-pipeline`
 * forbids building geometry outside it; the writer runs without a camera). It
 * depends on nothing but the object's own geometry, so it is safe to call from
 * all four.
 */

/* A point, or null. Number.isFinite rejects NaN and strings alike. */
function pt(value) {
  if (
    value &&
    Number.isFinite(Number(value.x)) &&
    Number.isFinite(Number(value.y))
  ) {
    return { x: Number(value.x), y: Number(value.y) };
  }

  return null;
}

/*
 * A DIRECTION, AS A UNIT VECTOR.
 *
 * The same convention the arrows are drawn with: y grows UP the sheet, so a
 * force of 270 degrees points down the page.
 */
function unit(angleDegrees) {
  const radians = ((Number(angleDegrees) || 0) * Math.PI) / 180;

  return { x: Math.cos(radians), y: Math.sin(radians) };
}

/*
 * The normal of a span, turned the same way `body-frames.js` turns it - so a
 * load's label stands off the same side its arrows point.
 */
function spanNormal(start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);

  if (length < 1e-9) {
    return { x: 0, y: -1 };
  }

  return { x: -dy / length, y: dx / length };
}

function midpoint(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/*
 * THE CLEARANCE A LABEL KEEPS FROM ITS OWN GEOMETRY, in drawing units.
 *
 * Enough to be read as separate from the arrowhead it names and not so much
 * that it floats away from it. It is a distance on the sheet, not a screen
 * nudge, so it scales with the drawing like every other length on it.
 */
export const LABEL_CLEARANCE = 4;

/*
 * THE ANCHOR OF A STATICS OBJECT'S LABEL, in drawing units.
 *
 * `null` means this object has no place to put a label of its own, and the
 * caller draws none rather than inventing one.
 */
/*
 * THE STATICS TYPES THAT CARRY A LABEL OF THEIR OWN.
 *
 * A note, a dimension, a Heat notation and a Fluids symbol have their own text
 * rules, and claiming them here would move every one of them. A Reference
 * Point, Line or Arc is shared ordinary geometry, so it is recognised by the
 * Statics role recorded when it was created.
 */
export function isStaticsLabelType(object) {
  const type = object?.type;

  if (!type) {
    return false;
  }

  if (STATICS_LABEL_TYPES.includes(type)) {
    return true;
  }

  return (
    (type === "point" || type === "line" || type === "arc") &&
    String(object?.engineering?.staticsType || "").startsWith("reference-")
  );
}

const STATICS_LABEL_TYPES = Object.freeze([
  "particle",
  "rigid-body",
  "beam",
  "truss",
  "cable",
  "shaft",
  "force",
  "resultant",
  "force-components",
  "load",
  "varying-load",
  "moment",
  "pin-support",
  "roller-support",
  "fixed-support",
  "smooth-support",
  "pin-connection",
  "fixed-connection",
  "slider-connection",
  "connection",
  "analysis-diagram",
  "shear-force-diagram",
  "bending-moment-diagram",
  "axial-force-diagram",
  "coordinate-system-2d",
  "coordinate-system"
]);

export function labelAnchorOf(object) {
  const g = object?.geometry || {};
  const type = object?.type;

  if (!isStaticsLabelType(object)) {
    return null;
  }

  /*
   * A POINT FORCE AND A RESULTANT ARE ARROWS. The label belongs past the
   * head, on the side the arrow points at, so it can never sit across the
   * shaft - which is why the direction of the drawn arrow decides, not its
   * magnitude.
   */
  if (type === "force" || type === "resultant" || type === "force-components") {
    const start = pt(g.start) || pt(g.position);
    const end = pt(g.end);

    if (start && end) {
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const length = Math.hypot(dx, dy);

      if (length >= 1e-9) {
        return {
          x: end.x + (dx / length) * LABEL_CLEARANCE,
          y: end.y + (dy / length) * LABEL_CLEARANCE,
        };
      }
    }

    const direction = unit(g.angle);

    return {
      x: (start ? start.x : 0) + direction.x * (LABEL_CLEARANCE * 2),
      y: (start ? start.y : 0) + direction.y * (LABEL_CLEARANCE * 2),
    };
  }

  /*
   * A DISTRIBUTED LOAD IS A FIELD OF ARROWS OVER A SPAN. Its label sits at
   * the middle of the span, standing off on the side the arrows point to -
   * never inside the field, where it would cross the arrows.
   */
  if (type === "load" || type === "varying-load") {
    const start = pt(g.start);
    const end = pt(g.end);

    if (!start || !end) {
      return null;
    }

    const mid = midpoint(start, end);
    const direction = unit(
      Number.isFinite(Number(g.direction)) ? g.direction : -90,
    );

    return {
      x: mid.x + direction.x * LABEL_CLEARANCE,
      y: mid.y + direction.y * LABEL_CLEARANCE,
    };
  }

  /*
   * A MOMENT IS AN ARC ABOUT A POINT. The label goes above the arc - clear of
   * the curve and of its arrowhead, which is on the arc itself - so a
   * clockwise and a counterclockwise moment are labelled identically.
   */
  if (type === "moment") {
    const position = pt(g.position);

    if (!position) {
      return null;
    }

    const radius = Number(g.arcRadius) || 7;

    return {
      x: position.x,
      y: position.y + radius + LABEL_CLEARANCE,
    };
  }

  /*
   * A SUPPORT'S SYMBOL IS DRAWN ON THE OUTSIDE OF ITS BODY. Its label is
   * beside the symbol, on the same side - `flipped` is which side that is -
   * and never between the symbol and the member it holds.
   */
  if (
    type === "pin-support" ||
    type === "roller-support" ||
    type === "fixed-support" ||
    type === "smooth-support"
  ) {
    const position = pt(g.position);

    if (!position) {
      return null;
    }

    const orientation = Number(g.orientation) || 0;
    const outward = { x: Math.sin(orientation), y: -Math.cos(orientation) };
    const side = g.flipped === true ? -1 : 1;

    return {
      x: position.x + outward.x * side * LABEL_CLEARANCE,
      y: position.y + outward.y * side * LABEL_CLEARANCE,
    };
  }

  /*
   * A CONNECTION RUNS BETWEEN TWO POINTS, so its label sits at the middle of
   * the link, which is the one place that covers neither attachment point.
   */
  if (
    type === "pin-connection" ||
    type === "fixed-connection" ||
    type === "slider-connection" ||
    type === "connection"
  ) {
    const start = pt(g.start);
    const end = pt(g.end);

    if (!start || !end) {
      return null;
    }

    const mid = midpoint(start, end);
    const normal = spanNormal(start, end);

    return {
      x: mid.x + normal.x * LABEL_CLEARANCE,
      y: mid.y + normal.y * LABEL_CLEARANCE,
    };
  }

  /*
   * A BODY'S LABEL STANDS OFF ITS CENTRE along the body's own normal, so it
   * follows the member when it is turned rather than staying page-side.
   */
  if (
    type === "beam" ||
    type === "truss" ||
    type === "cable" ||
    type === "shaft"
  ) {
    const start = pt(g.start);
    const end = pt(g.end);

    if (!start || !end) {
      return null;
    }

    const mid = midpoint(start, end);
    const normal = spanNormal(start, end);

    return {
      x: mid.x + normal.x * LABEL_CLEARANCE,
      y: mid.y + normal.y * LABEL_CLEARANCE,
    };
  }

  if (type === "particle" || type === "point") {
    const position = pt(g.position);

    return position
      ? { x: position.x + LABEL_CLEARANCE, y: position.y + LABEL_CLEARANCE }
      : null;
  }

  if (type === "rigid-body") {
    const position = pt(g.position);

    if (!position) {
      return null;
    }

    const width = Number(g.width) || 0;
    const height = Number(g.height) || 0;

    return {
      x: position.x + width / 2,
      y: position.y + height / 2 + LABEL_CLEARANCE,
    };
  }

  if (type === "arc") {
    const center = pt(g.center);
    const radius = Number(g.radius) || 0;
    const angle =
      (Number(g.startAngle) || 0) +
      ((Number(g.endAngle) || 0) - (Number(g.startAngle) || 0)) / 2;

    if (!center) {
      return null;
    }

    return {
      x: center.x + Math.cos(angle) * (radius + LABEL_CLEARANCE),
      y: center.y + Math.sin(angle) * (radius + LABEL_CLEARANCE),
    };
  }

  if (type === "line") {
    const start = pt(g.start);
    const end = pt(g.end);

    if (!start || !end) {
      return null;
    }

    const mid = midpoint(start, end);
    const normal = spanNormal(start, end);

    return {
      x: mid.x + normal.x * LABEL_CLEARANCE,
      y: mid.y + normal.y * LABEL_CLEARANCE,
    };
  }

  if (type === "analysis-diagram") {
    const start = pt(g.start);
    const end = pt(g.end);

    if (!start || !end) {
      return null;
    }

    return {
        x: Math.min(start.x, end.x),
        y: Math.max(start.y, end.y) + LABEL_CLEARANCE
    };
  }

  if (type === "coordinate-system-2d" || type === "coordinate-system") {
    const origin = pt(g.origin);

    if (!origin) {
      return null;
    }

    const arm =
      Number(g.yPositiveLength ?? g.yAxisLength ?? g.axisLength) || 25;

    return { x: origin.x, y: origin.y + arm + LABEL_CLEARANCE };
  }

  /* Anything else that stores a point is labelled beside that point. */
  const fallback =
    pt(g.position) || pt(g.center) || pt(g.origin) || pt(g.start);

  return fallback
    ? { x: fallback.x + LABEL_CLEARANCE, y: fallback.y + LABEL_CLEARANCE }
    : null;
}

/*
 * WHERE THE LABEL IS ACTUALLY DRAWN: the anchor, moved by the offset the
 * student set by dragging the label.
 *
 * The offset is clamped to finite numbers rather than trusted, because it
 * arrives from a saved file and from a drag, and an undefined offset must mean
 * "not moved" rather than putting a label at NaN.
 */
export function labelOffsetOf(object) {
  const offset = object?.geometry?.labelOffset || object?.labelOffset;

  if (!offset) {
    return { x: 0, y: 0 };
  }

  return {
    x: Number.isFinite(Number(offset.x)) ? Number(offset.x) : 0,
    y: Number.isFinite(Number(offset.y)) ? Number(offset.y) : 0,
  };
}

export function labelHomeOf(object) {
  const anchor = labelAnchorOf(object);

  if (!anchor) {
    return null;
  }

  const offset = labelOffsetOf(object);

  return { x: anchor.x + offset.x, y: anchor.y + offset.y };
}

/*
 * THE TEXT A STATICS OBJECT ACTUALLY DRAWS BESIDE ITSELF.
 *
 * `label` is the student's own words and nothing else: an object with no label
 * writes none. The object's NAME is not substituted for it - a name identifies
 * a row in the Objects list, and printing it on every force is what once put
 * "Point Force" at every arrowhead. A student who wants the name on the sheet
 * can type it.
 */
export function labelTextOf(object) {
  const label = object?.label;

  return typeof label === "string" ? label.trim() : "";
}

/*
 * MOVE A LABEL BY A DELTA, as a drag does.
 *
 * `delta` is measured from where the drag began, so this SETS the offset rather
 * than adding to it - the same rule the object's own move obeys, and the reason
 * a label does not overtake the pointer however long the drag runs.
 *
 * The offset is stored on the object (not on a separate text feature), so one
 * drag is one undo entry on one object.
 */
export function setLabelOffset(object, delta) {
  if (!object || typeof object !== "object") {
    return false;
  }

  if (!object.geometry) {
    return false;
  }

  object.geometry.labelOffset = {
    x: Number(delta?.x) || 0,
    y: Number(delta?.y) || 0,
  };

  return true;
}

/* Put the label back where its object would put it. */
export function resetLabelOffset(object) {
  if (object?.geometry && object.geometry.labelOffset !== undefined) {
    delete object.geometry.labelOffset;

    return true;
  }

  if (object && object.labelOffset !== undefined) {
    delete object.labelOffset;

    return true;
  }

  return false;
}

/*
 * ============================================================
 * THE HIT BOX OF A LABEL
 * ============================================================
 *
 * A label is picked by the WORDS, not by the object's geometry: clicking the
 * text must grab the text, because dragging it is how it is moved. The box is
 * estimated from the string and the drawing's text size - the same estimate the
 * renderer lays the words out with - and the four answers below are what the
 * hit test, the Fit bounds and the inline editor all share.
 */
export function labelBoxOf(object, options = {}) {
  const home = labelHomeOf(object);

  if (!home) {
    return null;
  }

  const text = labelTextOf(object);

  /*
   * AN EMPTY LABEL STILL HAS A PLACE. It has no ink, so it cannot be clicked
   * on the canvas, but the Features tab, the inline editor and the drag all
   * need the point it WOULD occupy - that is what "put the label here" means.
   */
  const fontSize = Math.max(1, Number(options.fontSize) || 14);
  const lineHeight = fontSize * 1.25;
  const lines = text ? text.split("\n") : [""];
  const width =
    Math.max(0, ...lines.map((line) => String(line).length)) * fontSize * 0.62;

  return {
    anchor: home,
    text,
    fontSize,
    lineHeight,
    width,
    height: Math.max(lineHeight, lines.length * lineHeight),
    left: home.x,
    right: home.x + width,
    top: home.y + lineHeight / 2,
    bottom: home.y - lineHeight * (lines.length - 0.5),
  };
}

export default {
  LABEL_CLEARANCE,
  isStaticsLabelType,
  labelAnchorOf,
  labelOffsetOf,
  labelHomeOf,
  labelTextOf,
  labelBoxOf,
  setLabelOffset,
  resetLabelOffset,
};

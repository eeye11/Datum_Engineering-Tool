/*
 * ============================================================
 * WHAT A CANVAS STEP'S DEMONSTRATION IS
 * ============================================================
 *
 * A step that asks the student to draw needs to SHOW the drawing: where it
 * starts, which way it goes and how big it is. This module turns a step's own
 * action into that demonstration, in DRAWING coordinates - never in screen
 * pixels - so the guide's overlay can project it through the live camera and
 * the path stays on the sheet through any zoom, pan or resize.
 *
 * WHY IT IS DERIVED FROM THE ACTION
 * ---------------------------------
 * A step already states what the student must achieve (`action`). The gesture
 * that achieves it is not a second fact to author - it follows from the tool's
 * real interaction model:
 *
 *   create line/rectangle/beam/pipe    press one end, drag to the other
 *   create circle                      press the centre, drag out the radius
 *   create point/force                 press once, at the point
 *   create arc                         three points along the curve
 *   create dimension                   the two ends of the thing measured
 *   select / change                    no drawing gesture - leave it to the
 *                                      ring on the control that starts it
 *
 * So a new tutorial step needs no demonstration of its own: it says what it
 * wants, and this table says how that is done. A kind or a type this module
 * does not know returns null, and the step falls back to the ordinary pointer,
 * which is the honest answer for a step that is not a canvas gesture.
 *
 * WHY THE SHAPE SITS WHERE IT DOES
 * --------------------------------
 * The path is placed around the CENTRE OF THE VISIBLE SHEET, in drawing units,
 * and scaled by how much of the sheet is on screen. Two consequences, both
 * wanted:
 *
 *   - it is always visible, whatever the student has panned to;
 *   - it is a sensible SIZE at any zoom, because the size is measured in
 *     drawing units the student can actually see, not in pixels.
 *
 * The start and end are snapped to the grid the student is drawing on, so the
 * demonstrated gesture lands on the same lattice as a real one would.
 */

/*
 * The demonstration's proportions, in DRAWING UNITS relative to the visible
 * sheet. They are fractions of the visible width/height, so the mark is never
 * a speck at 25% zoom nor a wall at 400%.
 */
const SHAPE = {
  /* A long two-point gesture - a line, a beam, a run. */
  span: { dx: 0.26, dy: 0.16 },

  /* A box - a rectangle, a region, a plot. */
  box: { dx: 0.2, dy: 0.15 },

  /* A radius, from the centre outwards. */
  radius: { dx: 0.14, dy: 0.1 },

  /* An arc's three points, as fractions of the visible width. */
  arc: { dx: 0.2, dy: 0.12 },

  /* A dimension sits just outside the thing it measures. */
  dimension: { dx: 0.26, dy: 0.02 },
};

/*
 * The tools whose gesture is a PRESS AND A DRAG between two points. Asked as a
 * table rather than by testing each id at each call site, so the reason a tool
 * is or is not here is one line of data.
 */
const TWO_POINT_TYPES = [
  "line",
  "rectangle",
  "triangle",
  "polygon",
  "beam",
  "pipe-duct",
  "plate",
  "region",
];

/* Shapes whose gesture is the CENTRE and a point on the curve. */
const RADIAL_TYPES = ["circle", "ring", "disk"];

/* Shapes placed at ONE point. */
const POINT_TYPES = ["point", "force", "support", "moment", "node"];

/* Curved shapes built from three points along the curve. */
const ARC_TYPES = ["arc", "reference-arc"];

function snap(value, spacing) {
  if (!Number.isFinite(spacing) || spacing <= 0) {
    return value;
  }

  return Math.round(value / spacing) * spacing;
}

/*
 * THE VIEW, AS THE DEMONSTRATION NEEDS IT.
 *
 * `centre` is the drawing point at the middle of the canvas, and `units` is how
 * many drawing units the canvas spans. Both come from the camera the canvas
 * itself uses, so they cannot disagree with the sheet.
 */
function point(centre, offsetX, offsetY, spacing) {
  return {
    x: snap(centre.x + offsetX, spacing),
    y: snap(centre.y + offsetY, spacing),
  };
}

/*
 * THE DEMONSTRATION FOR A STEP, OR NULL.
 *
 * `view` is { centre, units, spacing } in drawing coordinates; see
 * `demoView` in the tutorial overlay, which builds it from the live camera.
 */
export function demoFor(step, view) {
  const action = step?.action;

  if (!action || !view?.centre || !view?.units) {
    return null;
  }

  const { centre, units, spacing } = view;

  const width = units.width || 100;
  const height = units.height || 100;

  const span = (shape) => ({
    from: point(centre, -width * shape.dx, -height * shape.dy, spacing),
    to: point(centre, width * shape.dx, height * shape.dy, spacing),
  });

  if (action.kind === "create") {
    const type = String(action.type || "");

    if (ARC_TYPES.includes(type)) {
      /* Three points along the curve, in the order the tool asks for them. */
      return {
        kind: "path",
        from: point(centre, -width * SHAPE.arc.dx, 0, spacing),
        via: point(centre, 0, height * SHAPE.arc.dy, spacing),
        to: point(centre, width * SHAPE.arc.dx, 0, spacing),
      };
    }

    if (RADIAL_TYPES.includes(type)) {
      return {
        kind: "drag",
        from: point(centre, 0, 0, spacing),
        to: point(centre, width * SHAPE.radius.dx, -height * SHAPE.radius.dy, spacing),
      };
    }

    if (POINT_TYPES.includes(type)) {
      return {
        kind: "point",
        from: point(centre, 0, 0, spacing),
      };
    }

    if (type === "dimension") {
      /* A dimension spans the thing it measures, slightly outside it. */
      return {
        kind: "drag",
        from: point(centre, -width * SHAPE.dimension.dx, height * SHAPE.dimension.dy, spacing),
        to: point(centre, width * SHAPE.dimension.dx, height * SHAPE.dimension.dy, spacing),
      };
    }

    if (TWO_POINT_TYPES.includes(type)) {
      return { kind: "drag", ...span(SHAPE.box) };
    }

    /*
     * AN UNKNOWN CREATION TYPE IS NOT GUESSED AT. The ordinary pointer still
     * names the canvas, which is honest; inventing a gesture for a shape whose
     * real interaction this module does not know would teach the wrong thing.
     */
    return null;
  }

  if (action.kind === "change") {
    /* Moving or resizing: from where it is now to somewhere clear of it. */
    return {
      kind: "drag",
      from: point(centre, -width * 0.05, 0, spacing),
      to: point(centre, width * 0.12, -height * 0.06, spacing),
    };
  }

  /*
   * Tool, category, property, panel, zoom, setting, source, delete, undo and
   * finish are NOT canvas gestures: they are done on a control, and the ring
   * that marks that control is what teaches them. Nothing is demonstrated on
   * the sheet for those, which is why they fall through to null.
   */
  return null;
}

export default { demoFor };

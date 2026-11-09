/*
 * ============================================================
 * A VECTOR'S MAGNITUDE, TYPED ON THE DRAWING
 * ============================================================
 *
 * A Polar Vector is a Kinematics symbol, and an Angular Vector is a rotation
 * symbol. Both are drawn as vectors - one along a span, one along an arc - and
 * both mean the same thing in their own units as a Statics Point Load means in
 * newtons and an Applied Moment means in newton-metres: a stated quantity with
 * a direction and a sense.
 *
 * So they are created the same way those tools are:
 *
 *   - the symbol is placed (a drag, like a Point Force), and committed;
 *   - the MAGNITUDE is asked for as ONE LINE OF TEXT ON THE DRAWING, at the
 *     symbol's own drawn point (the arrowhead), through the same in-page field
 *     (`placement-value-field.js`) the Statics tools use;
 *   - THEN the name is asked for, from the same creation-label field - so a
 *     vector ends up with the symbol the student named it and the quantity
 *     they stated.
 *
 * THERE IS NO POPUP. A value typed into the drawing is entered INTO the
 * drawing: the field IS the feature's text, and committing it writes the
 * feature exactly as the Statics path writes a force or a moment.
 *
 * WHAT THE ANSWER MEANS
 * ---------------------
 * The one value reader (`readStaticsValue`) is used, so a number, a unit, an
 * empty box (Unknown) and the student's own symbol all mean what they mean
 * everywhere else. A number with a unit is converted to the vector's base unit
 * before it is stored - the same mirror of the panel's display conversion the
 * Statics path applies, so typing `2 m/s` cannot store two millimetres per
 * second.
 *
 * WHAT IS WRITTEN
 * ---------------
 * `geometry.magnitude` (the number), `unknownValues.magnitude` (Unknown) and
 * `magnitudeLabel` (a symbol). A polar vector's drawn length follows: a number
 * rebuilds the span to that length along its drawn direction, so the arrow the
 * student sees is the arrow they measured. An angular vector keeps the radius
 * it was drawn with and writes the stated quantity as the label beside the arc
 * - its magnitude was never a length, and turning `ω` into a radius would
 * invent a size the surface does not state.
 */

import enggDrawingState from "../../../shared/model/drawing-state.js";
import enggQuantities from "../../../shared/units/quantities.js";
import {
  applyStaticsValue,
  readStaticsValue,
} from "../../../shared/ui/editors/load-value-popup.js";
import { openPlacementValueField } from "../../../shared/ui/editors/placement-value-field.js";
import { creationLabelPrompt } from "../../../shared/ui/editors/creation-label.js";
import { renderProperties } from "../../../components/layout/panels/feature-panel.js";
import { renderCurrentDrawing } from "../../../components/layout/workspace/canvas-render.js";
import { setToolMessage } from "../../../components/layout/toolbar/toolbar-render.js";

/*
 * THE KINDS OF VECTOR, and the unit a bare number is read in.
 *
 * A polar vector's magnitude is a speed or an acceleration; an angular
 * vector's is a rate of rotation. Both are asked in the unit the panel offers,
 * and both are stored in the base unit of their kind (m/s, rad/s).
 */
const KINDS = Object.freeze({
  "dynamics-polar-vector": Object.freeze({
    label: "Polar Vector",
    kind: "speed",
    baseUnit: "m/s",
    empty: "length Unknown",
  }),
  "dynamics-angular-vector": Object.freeze({
    label: "Angular Vector",
    kind: "angle",
    baseUnit: "rad/s",
    empty: "angular magnitude Unknown",
  }),
});

/* The `engineering.dynamicsType` of an object, or null. */
function vectorTypeOf(object) {
  const type = object?.engineering?.dynamicsType;

  return KINDS[type] ? type : null;
}

/*
 * Whether an object is a Dynamics vector that asks for its magnitude as it is
 * created. Re-exported so a caller can ask without reading the table.
 */
export function isDynamicsVector(object) {
  return Boolean(vectorTypeOf(object));
}

/*
 * The drawn point the magnitude is asked at - the arrowhead, which is where
 * the finished quantity is written.
 */
function magnitudePointOf(object) {
  const geometry = object?.geometry || {};

  if (object?.type === "dynamics-angular-vector" && geometry.center) {
    const radius = Number(geometry.radius) || 0;

    return {
      x: geometry.center.x + radius,
      y: geometry.center.y - radius,
    };
  }

  return geometry.end || geometry.center || geometry.position || null;
}

/*
 * REBUILD A POLAR VECTOR AT THE STATED LENGTH.
 *
 * The direction is the one the drag chose; the length becomes the stated one,
 * so the arrow the student sees is the one whose size they just typed.
 */
function rebuildPolarVector(object, magnitude) {
  const geometry = object.geometry || (object.geometry = {});

  if (!geometry.start || !geometry.end) {
    return;
  }

  const dx = geometry.end.x - geometry.start.x;
  const dy = geometry.end.y - geometry.start.y;
  const length = Math.hypot(dx, dy);

  if (!(length > 1e-9)) {
    return;
  }

  geometry.end = {
    x: geometry.start.x + (dx / length) * magnitude,
    y: geometry.start.y + (dy / length) * magnitude,
  };

  geometry.vectorMagnitude = magnitude;
  geometry.vectorAngle = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;

  geometry.magnitude = magnitude;
}

/*
 * ASK THE VECTOR FOR ITS MAGNITUDE, ON THE DRAWING.
 *
 *   object     the committed vector
 *   state      the drawing state, so the field follows the camera
 *   previous   the snapshot before the vector existed (its own undo entry)
 *   cameraSignal  the editor's camera subscription
 *
 * Committing the number commits the vector's undo entry and then asks for its
 * name - in the same order a Moment or a Point Load asks. Escape on the
 * magnitude abandons only the value (the vector keeps the length its drag
 * chose, not a number the student never gave).
 */
export function promptForVectorMagnitude(
  object,
  { state = null, previous = null, cameraSignal = null, onDone = null } = {},
) {
  const type = vectorTypeOf(object);

  if (!type) {
    return false;
  }

  const kind = KINDS[type];

  setToolMessage(
    `Enter the ${kind.label.toLowerCase()} magnitude - leave it empty for Unknown`,
  );

  openPlacementValueField({
    object,
    point: magnitudePointOf(object),
    value: "",
    state,
    cameraSignal,

    onApply: (confirmed) => {
      const answer = readStaticsValue(confirmed.text, kind.baseUnit);

      if (answer.kind === "number") {
        /*
         * THE STORED MAGNITUDE IS IN THE BASE UNIT. A number typed with its own
         * unit is converted back before it is stored - the mirror of the panel
         * conversion - so `2 km/h` cannot become two metres per second.
         */
        answer.value =
          enggQuantities.convertValue(
            answer.value,
            kind.kind,
            answer.unit || kind.baseUnit,
            kind.baseUnit,
          ) ?? answer.value;

        if (type === "dynamics-polar-vector") {
          rebuildPolarVector(object, answer.value);
        } else {
          object.geometry = object.geometry || {};
          object.geometry.magnitude = answer.value;
        }

        if (answer.unit) {
          object.geometry.unit = answer.unit;
        }

        setToolMessage(
          `${kind.label} placed - ${answer.value} ${answer.unit || kind.baseUnit}`,
        );
      } else if (answer.kind === "symbol") {
        setToolMessage(`${kind.label} placed - ${answer.text}`);
      } else {
        setToolMessage(`${kind.label} placed - ${kind.empty}`);
      }

      applyStaticsValue(object, answer, { valueKey: "magnitude" });

      if (state && previous) {
        enggDrawingState.commitDrawingChange(state, previous);
      }

      renderProperties();
      renderCurrentDrawing();

      /*
       * AND THEN ITS NAME - the same creation-label field as every other label,
       * so the symbol the student names the vector is written where the words
       * sit, in its own colour, with no second question.
       */
      creationLabelPrompt(object, {
        state,
        cameraSignal,
        onDone: () => {
          renderProperties();
          renderCurrentDrawing();

          if (typeof onDone === "function") {
            onDone();
          }
        },
      });
    },

    onCancel: () => {
      setToolMessage(`${kind.label} placed - ${kind.empty}`);

      if (typeof onDone === "function") {
        onDone();
      }
    },
  });

  return true;
}

export default {
  isDynamicsVector,
  promptForVectorMagnitude,
};

/*
 * ========================================================
 * THE DOCUMENT'S ACTIVE LENGTH UNIT - ONE SETTING, READ ONCE
 * ========================================================
 *
 * A drawing states lengths in ONE unit at a time. The unit is not a property
 * of a beam or of a pipe run or of the Diameter field within one of them: it
 * is a fact about the DRAWING, exactly as its scale is. So it lives in one
 * place - the document's own `units` - and every length-bearing field in the
 * application reads it from there.
 *
 * ========================================================
 * WHY THIS IS A MODULE AND NOT A FIELD ON EACH FEATURE
 * ========================================================
 *
 * It used to be a field on each feature (`object.lengthUnit`), so a beam could
 * be read in metres while the pipe run beside it read in millimetres - and the
 * unit was not shared, so changing one feature's unit could not possibly move
 * another's. That is the opposite of what a drawing-wide unit means: the
 * student changes the unit once, wherever they happen to be, and the whole
 * drawing is read in it.
 *
 * The document's `units` field already existed and already travels everywhere
 * a document setting has to: it is captured onto the sheet, restored when the
 * sheet is switched, written into the saved file, and included in the undo
 * snapshot. Routing every inline unit dropdown through THIS accessor means the
 * propagation to the other dropdowns is not a separate feature - it falls out
 * of there being one value to read.
 *
 * ========================================================
 * WHAT IT IS NOT
 * ========================================================
 *
 * It is not the CALIBRATION unit. The scale records the unit a measured length
 * was stated in when the sheet was calibrated (`scale.unit`), and that is a
 * fact about how the scale was established. This is the unit the drawing is
 * READ in now, which the student may change at any time without moving a
 * single feature - because a unit is a way of writing a length, not a length.
 *
 * And it is not a LENGTH. Converting a length into this unit is a pure
 * display conversion (`quantities.convertValue`), so changing the unit cannot
 * move geometry, break a connection or shift an endpoint: the millimetres
 * underneath are untouched. That is what "preserve the actual physical
 * geometry" means, and it is guaranteed by the conversion being a read rather
 * than a write.
 */

import enggQuantities from "./quantities.js";

/*
 * THE QUANTITY THIS SETTING DENOMINATES.
 *
 * Length only. Angular quantities keep their own convention and are not this
 * module's to change - a degree is not a millimetre, and the unit table would
 * refuse the conversion if a caller tried to make it one.
 */
const QUANTITY = "length";

/*
 * The unit a document with no stated unit is read in.
 *
 * Millimetres, the base unit of the length table and the unit every geometry
 * feature was read in before this setting could be changed. Reading an absent
 * or unknown value as "mm" is the conservative reading of "nobody said
 * otherwise", so a drawing saved before the unit was changeable opens exactly
 * as it was.
 */
const DEFAULT_UNIT = "mm";

/*
 * The unit the document is currently read in.
 *
 * A unit the length quantity does not have - a stale value, a hand-edited
 * file, a force's "kN" - is refused and read as the default rather than being
 * handed back. That is what stops a panel building a length selector whose
 * current value is not among its own options, which is how a select snaps to
 * its first option and silently changes the unit.
 */
function documentLengthUnit(state) {
  const stored = state?.units;

  return enggQuantities.isUnitFor(QUANTITY, stored) ? stored : DEFAULT_UNIT;
}

/*
 * Write the document's unit.
 *
 * The value is validated against the SAME table the panel offers, so a unit
 * the dropdown cannot show can never be stored - the check and the options are
 * one list, and cannot disagree.
 *
 * Millimetres are stored as the default rather than as a special case, so a
 * document read in mm and a document that has never chosen a unit are the same
 * document. That is the convention the rest of the document's settings follow,
 * and it keeps a saved drawing's shape stable as the student changes units.
 *
 * Returns the unit now in force, so a caller can report or re-render from the
 * value that was actually accepted rather than the one it asked for.
 */
function setDocumentLengthUnit(state, unit) {
  if (!state) {
    return DEFAULT_UNIT;
  }

  const chosen = enggQuantities.isUnitFor(QUANTITY, unit) ? unit : DEFAULT_UNIT;

  state.units = chosen;

  return chosen;
}

/*
 * Every unit a length may be read in, in the order the dropdowns offer them.
 *
 * Read from the shared quantity table rather than restated, so adding a unit
 * there adds it to every dropdown at once - and so a dropdown cannot offer a
 * unit the conversion cannot handle.
 */
function documentLengthUnits() {
  return enggQuantities.unitsFor(QUANTITY);
}

const enggDocumentUnits = {
  QUANTITY,
  DEFAULT_UNIT,
  documentLengthUnit,
  setDocumentLengthUnit,
  documentLengthUnits,
};

export default enggDocumentUnits;

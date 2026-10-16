/*
 * ========================================================
 * DEEP COPYING
 * ========================================================
 *
 * `JSON.parse(JSON.stringify(value))` is the deep copy this application uses
 * everywhere - in the model, the sheets, the templates, the API and the
 * editors. It is the right tool: a feature is plain data with no functions,
 * dates or cycles, and a JSON round trip is both a copy and a check that the
 * value really is plain data.
 *
 * WHY IT IS A FUNCTION RATHER THAN A HABIT.
 *
 * Written out at each site, the idiom has one sharp edge that has already cut
 * this codebase once: `JSON.stringify(undefined)` returns `undefined`, and
 * `JSON.parse(undefined)` then THROWS. A feature whose optional sub-object is
 * absent - a dimension with no `geometry`, an annotation before its first
 * placement - would therefore fail to copy, and because copying happens on the
 * way into a SAVE, the failure was that saving a drawing containing any such
 * feature did not work at all. See the note in drawing-state's
 * `cloneFeatureForSave`, which is the same defect found the hard way.
 *
 * One function with the undefined case handled means that class of bug cannot
 * come back by someone writing the idiom out again and not thinking about it.
 *
 * `undefined` COPIES TO `undefined`, which is what a caller assigning the
 * result back wants: `copy.geometry = deepClone(object.geometry)` leaves the
 * field absent when it was absent, rather than inventing a `null` for it.
 *
 * A value that cannot be serialised at all - a function, a cyclic reference -
 * is NOT silently swallowed. The copy is a copy or it is an error; a quiet
 * fallback would hand back a half-copied object that looks whole.
 */

export function deepClone(value) {
  /*
   * `undefined` AND `null` PASS THROUGH.
   *
   * `null` would survive the round trip anyway, but testing both together
   * makes the two absent-ish cases one branch, so a reader does not have to
   * work out whether `null` is handled.
   */
  if (value === undefined || value === null) {
    return value;
  }

  return JSON.parse(JSON.stringify(value));
}

/*
 * A copy of an array of features, with the empty case answered directly.
 *
 * `deepClone([])` is `[]` and would work, but the callers of this are the
 * snapshot and history paths, which run on every document change - so the
 * common "nothing here" case is worth not walking through JSON.
 */
export function deepCloneAll(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return [];
  }

  return deepClone(values);
}

const enggClone = {
  deepClone,
  deepCloneAll,
};

export default enggClone;

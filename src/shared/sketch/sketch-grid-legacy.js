/*
 * ============================================================
 * THE LEGACY GRAPH FIELD ADAPTER
 * ============================================================
 *
 * A bridge between the OLD coordinate fields stored on a placed math graph and
 * the shared grid model every surface now draws from.
 *
 * WHY THIS EXISTS
 * ---------------
 * Graphs saved before the migration carry their coordinate system as a set of
 * FLAT geometry fields - `showGrid`, `xTickSpacing`, `gridDivisions` and the
 * rest. The new model is one nested object with one name per concept. Reading
 * the old fields directly from the new painter would be a second source of
 * truth; rewriting them on load would silently change drawings that are
 * already correct.
 *
 * So the conversion happens HERE, once, and only when a graph has no `grid`
 * of its own. A graph that already has one is left exactly as it is.
 *
 * THE ONE RULE THAT MATTERS MOST
 * ------------------------------
 * `showGrid: false` MUST NOT BECOME A VISIBLE GRID.
 *
 * The shared model's default is "major grid on", which is right for a new
 * sketch. But a graph saved by the old editor with `showGrid: false` was saved
 * with NO grid, and defaulting it back on would put graph paper under every
 * curve that never had any - on the main sheet, in every reopened file. The
 * absence of a field is therefore read as "the old default", while an explicit
 * `false` is honoured as what it says.
 *
 * The same care applies to `showXAxis`/`showYAxis`, which the Sketch Editor
 * writes as `false` when it commits a sketch, and to `showTickLabels`, which
 * the old editor wrote as `true` by default.
 */

import { normaliseGrid } from "./sketch-grid.js";

/*
 * Whether a stored value is a real number.
 *
 * `null`, `""` and `false` all coerce to finite numbers (`0`, `0`, `0`), so a
 * plain `Number.isFinite(Number(value))` would read an UNSET field as zero -
 * the same defect the graph limits had, where an unset -10..5 became 0..5.
 */
function isSet(value) {
  return typeof value === "number" && Number.isFinite(value);
}

/* A positive interval, or null when the field does not say one. */
function positive(value) {
  return isSet(value) && value > 0 ? value : null;
}

/*
 * ============================================================
 * OLD FIELDS -> SHARED GRID
 * ============================================================
 *
 * Returns a COMPLETE grid object. `geometry.grid`, when present, wins outright;
 * otherwise every field is derived from the legacy keys with the defaults that
 * reproduce the old drawing exactly.
 */
export function gridFromGeometry(geometry) {
  const g = geometry || {};

  /*
   * A GRAPH WITH ITS OWN GRID IS ALREADY MIGRATED. Fill in anything a newer
   * version added, but never overwrite what it stores.
   */
  if (g.grid && typeof g.grid === "object") {
    return normaliseGrid(g.grid);
  }

  /*
   * THE TICK INTERVALS.
   *
   * `xTickSpacing`/`yTickSpacing` are the old names for the major intervals,
   * and `null` means "work it out from the range". The shared model has no
   * nullable interval, so an unset one is derived from the span - which is
   * what the old renderer did too (`tickValues` fell back to a round step
   * chosen from the range).
   */
  const spanX = isSet(g.xMin) && isSet(g.xMax) ? g.xMax - g.xMin : 10;
  const spanY = isSet(g.yMin) && isSet(g.yMax) ? g.yMax - g.yMin : 10;

  const majorX = positive(g.xTickSpacing) || niceStep(spanX, 10);
  const majorY = positive(g.yTickSpacing) || niceStep(spanY, 10);

  /*
   * `gridDivisions` was "how many grid lines per labelled tick" - a SKETCH
   * drew a finer grid than its labels. In the shared model that is
   * `minorDivisions`, and the fine lines are the MINOR grid. So a legacy
   * graph with divisions > 1 wants minor grid on; one with divisions of 1
   * wants none, because its grid already sits at the major interval.
   */
  const divisions = Number(g.gridDivisions);

  const divisionsUsed =
    Number.isFinite(divisions) && divisions > 1
      ? Math.max(1, Math.min(50, Math.round(divisions)))
      : 1;

  /*
   * THE VISIBILITY FIELDS, READ AS THE OLD EDITOR WROTE THEM.
   *
   *   showGrid        default ON  (the old editor's default)
   *   showMinorGrid   default OFF
   *   showXAxis       default ON
   *   showYAxis       default ON
   *   showTickLabels  default ON  (the old editor showed numbers)
   *
   * An explicit `false` is honoured; an absent field takes the old default.
   */
  const showGrid = g.showGrid !== false;
  const showMinorGrid = g.showMinorGrid === true;

  return normaliseGrid({
    showXAxis: g.showXAxis !== false,
    showYAxis: g.showYAxis !== false,

    /*
     * THE ORIGIN IS A NEW CONTROL. The old editor had no origin MARK - it drew
     * the two axes crossing, which is the same thing visually. Showing it when
     * both axes are on reproduces the old picture.
     */
    showOrigin: g.showXAxis !== false && g.showYAxis !== false,
    showAxisLabels: false,
    xAxisLabel: typeof g.xLabel === "string" && g.xLabel ? g.xLabel : "x",
    yAxisLabel: typeof g.yLabel === "string" && g.yLabel ? g.yLabel : "y",

    showTicks: showGrid || g.showXAxis !== false || g.showYAxis !== false,
    showTickLabels: g.showTickLabels !== false,

    majorX,
    majorY,
    linkXYIntervals: g.equalUnits === true,
    minorDivisions: divisionsUsed,

    showMajorGrid: showGrid,
    showMinorGrid: showMinorGrid && showGrid,

    /*
     * THE OLD GRID WAS ALWAYS A LIGHT DASHED LINE. Reproducing it is what
     * keeps a reopened drawing looking like the one that was saved.
     */
    majorStyle: "dashed",
    minorStyle: "dotted",

    /*
     * AXES AND GRID IN THE OUTPUT: the old graph drew its grid on the sheet
     * whenever `showGrid` was on, so that is what an existing drawing expects.
     * It is independent of the preview toggles from here on.
     */
    includeInOutput: showGrid || g.showXAxis !== false || g.showYAxis !== false,
  });
}

/*
 * ============================================================
 * SHARED GRID -> OLD FIELDS
 * ============================================================
 *
 * Written on every save so a drawing opened by an older build - or read by a
 * consumer that has not been migrated yet - still finds the fields it knows.
 * This is the "dual write" half of the migration, and it is what makes the
 * change reversible.
 */
export function applyGridToGeometry(geometry, grid) {
  if (!geometry || typeof geometry !== "object") {
    return geometry;
  }

  const settings = normaliseGrid(grid);

  geometry.grid = settings;

  /*
   * THE LEGACY MIRRORS. `xTickSpacing` stays NULL when the interval was
   * derived from the range rather than chosen, because a stored number would
   * freeze a step that used to follow the bounds.
   */
  geometry.xTickSpacing = settings.majorX;
  geometry.yTickSpacing = settings.majorY;

  geometry.showGrid = settings.showMajorGrid;
  geometry.showMinorGrid = settings.showMinorGrid;
  geometry.showXAxis = settings.showXAxis;
  geometry.showYAxis = settings.showYAxis;
  geometry.showTickLabels = settings.showTickLabels;
  geometry.gridDivisions = Math.max(1, Math.round(settings.minorDivisions));
  geometry.equalUnits =
    settings.linkXYIntervals || geometry.equalUnits !== false;
  geometry.xLabel = settings.xAxisLabel;
  geometry.yLabel = settings.yAxisLabel;

  return geometry;
}

/*
 * A ROUND STEP FOR A SPAN, chosen the way the old tick generator did.
 *
 * Only used when a legacy graph stores no interval: the result is the nearest
 * 1, 2 or 5 times a power of ten to `span / samples`, which is the sequence
 * that reads as "nice numbers" on an axis.
 */
export function niceStep(span, samples = 10) {
  const raw = Math.abs(Number(span)) / Math.max(1, samples);

  if (!Number.isFinite(raw) || raw <= 0) {
    return 1;
  }

  const magnitude = Math.pow(10, Math.floor(Math.log10(raw)));
  const normalised = raw / magnitude;

  const step =
    normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 5 ? 5 : 10;

  return step * magnitude;
}

export default {
  applyGridToGeometry,
  gridFromGeometry,
  niceStep,
};

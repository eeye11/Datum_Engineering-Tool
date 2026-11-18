/*
 * ============================================================
 * A PLACED GRAPH'S COORDINATE SYSTEM, FOR THE SHARED PAINTER
 * ============================================================
 *
 * The shared axes painter (`sketch-axes.js`) draws in EDITOR terms: it asks a
 * viewport for a visible model rectangle, a scale on each axis and a function
 * from a model point to a pixel.
 *
 * A graph PLACED ON THE SHEET has none of those. It has a frame - a rectangle
 * in drawing coordinates - a set of limits and an inset for the tick numbers
 * that sit outside the plot area. Asking it for a pixel scale is meaningless:
 * the sheet is drawn in model millimetres and the camera scales the whole
 * picture afterwards.
 *
 * So this module presents a placed graph AS a viewport. It is an ADAPTER, not
 * a second painter and not a second coordinate system: the mapping decisions
 * are `graphMapping`'s, which is the one function that has always known where
 * a graph's plot area is, and the drawing is the shared painter's.
 *
 * WHY NOT A PIXEL SCALE.
 * `scaleX`/`scaleY` here are "model units per drawing unit" - how many units of
 * the graph's own x span fit across one millimetre of sheet. The painter uses
 * them only for `gridRenderable`, which asks whether grid lines are far enough
 * apart to read; answering in drawing units makes that decision about the
 * PRINTED sheet, which is the only size a placed graph has.
 */

/**
 * Build a viewport-like object for one placed graph.
 *
 * @param entity   the graph object (its `geometry` carries frame and limits)
 * @param model    the math model module - `graphMapping`, `graphToDrawing`
 * @returns a viewport the shared painter accepts, or null when the graph
 *          cannot be mapped at all.
 */
export function graphViewport(entity, model) {
  const mapping = model.graphMapping(entity);

  if (!mapping) {
    return null;
  }

  const { limits, left, right, top, bottom } = mapping;

  /*
   * THE VISIBLE RECTANGLE IS THE PLOT AREA, not the frame. The frame includes
   * the inset reserved for tick numbers, and a grid drawn across the inset
   * would run through the labels.
   */
  const visible = {
    xMin: limits.xMin,
    xMax: limits.xMax,
    yMin: limits.yMin,
    yMax: limits.yMax,
  };

  const spanX = Math.max(visible.xMax - visible.xMin, 1e-9);
  const spanY = Math.max(visible.yMax - visible.yMin, 1e-9);

  /*
   * A DEGENERATE PLOT AREA GIVES A USELESS SCALE, AND A USELESS SCALE HIDES
   * THE GRID.
   *
   * The old code clamped the span to 1e-9, which turned a collapsed area into
   * a scale of ~1e-10 - and `gridRenderable` takes the SMALLER of the two axis
   * spacings, so one bad axis silently suppressed the whole grid. A graph was
   * left with axes and numbers but no grid paper, at any span.
   *
   * A plot area that cannot be measured is replaced with a sane one rather than
   * a nearly-zero one, so the readability test answers about a real drawing.
   */
  const MIN_AREA = 1;

  /*
   * THE EXTENT IS AN ABSOLUTE DIFFERENCE, NOT AN ORDERING ASSUMPTION.
   *
   * `left`/`right` and `top`/`bottom` name a RECTANGLE; which pair is smaller
   * depends on the axis's direction, and the sheet's y grows upward while the
   * graph's own area is computed the other way round. Subtracting in a fixed
   * order gave a negative height, which the clamp turned into nothing - and
   * `gridRenderable` takes the SMALLER of the two axis spacings, so a collapsed
   * height suppressed the X grid lines as well as the Y ones. The graph then
   * drew axes and numbers with no grid paper at all.
   */
  const width = Math.max(Math.abs(right - left), MIN_AREA);
  const height = Math.max(Math.abs(bottom - top), MIN_AREA);

  return {
    /*
     * THE SHEET'S OWN UNITS. One drawing unit is one millimetre, and the
     * painter's tick length is a HAND length in those same units - which is
     * exactly what a printed tick wants.
     */
    width,
    height,
    bounds: visible,
    visible,

    /*
     * ONE VIEWPORT UNIT IS ONE SCREEN PIXEL, so the scales are stated the way
     * the painter reads them.
     *
     * `gridRenderable` asks "are these lines far enough apart to read?" and
     * measures the answer in pixels. A placed graph is drawn in drawing
     * millimetres, and the canvas paints one drawing unit as one base pixel at
     * 100% - so a scale measured in millimetres IS a scale measured in pixels,
     * and the grid survives the same readability test it always did.
     *
     * Stating it the other way round (model units per millimetre) inverted the
     * test: a 2-unit grid on a 12-unit span computed as 0.17 "pixels" apart and
     * was suppressed as unreadable, so a graph that should have shown its grid
     * drew none.
     */
    scaleX: spanX > 0 ? width / spanX : 1,
    scaleY: spanY > 0 ? height / spanY : 1,

    /*
     * `equal` is reported as the GRAPH's own choice, not re-derived here: the
     * graph already decided it when it computed its mapping, and a second
     * opinion is how two parts of the same picture start disagreeing.
     */
    equal: Math.abs(width / spanX - height / spanY) < 1e-9,

    /*
     * MODEL -> DRAWING. Whatever the painter hands in is a point in graph
     * coordinates; `graphToDrawing` is the function that has always turned one
     * into a place on the sheet, so the curve, the grid and the axes all land
     * through the same transform.
     */
    toScreen: (point) => model.graphToDrawing(entity, point) || { x: 0, y: 0 },
  };
}

/*
 * THE LAYERS A PLACED GRAPH DRAWS, FROM ITS OWN VISIBILITY SETTINGS.
 *
 * A placed graph IS the output, so there is no "include in the export" step to
 * apply here - the brief's include/export choice governs a plot still inside
 * the editor preview, not one already on the sheet. What this answers is which
 * of the ten layers the graph's own settings turn on, so the shared painter
 * draws exactly the layers the old renderer drew for the same settings.
 *
 * `null` means "no restriction" - draw every layer the settings allow.
 */
export function outputLayersFor(grid) {
  const layers = [];

  if (grid?.showMinorGrid) {
    layers.push("minorGrid");
  }

  if (grid?.showMajorGrid) {
    layers.push("majorGrid");
  }

  if (grid?.showXAxis) {
    layers.push("xAxis");
  }

  if (grid?.showYAxis) {
    layers.push("yAxis");
  }

  if (grid?.showOrigin && grid?.showXAxis && grid?.showYAxis) {
    layers.push("origin");
  }

  if (grid?.showTicks) {
    layers.push("ticks");
  }

  if (grid?.showTickLabels) {
    layers.push("tickLabels");
  }

  if (grid?.showAxisLabels) {
    layers.push("axisLabels");
  }

  return layers;
}

export default {
  graphViewport,
  outputLayersFor,
};

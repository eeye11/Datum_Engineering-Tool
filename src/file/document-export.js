/*
 * The one place a drawing is turned into something you can look at
 * outside the editor.
 *
 * PNG, JPG, SVG and Print all need the same thing: the complete
 * drawing, fitted to its own bounds, drawn with no application
 * chrome and no selection overlay. If each of them worked that out
 * for itself they would drift - one would miss a feature type, one
 * would crop, one would include the toolbars - and the same drawing
 * would come out differently depending on how it was exported.
 *
 * So there is one pipeline, and this is it:
 *
 *   document -> rendered bounds -> autofit -> clean render -> output
 *
 * It is deliberately separate from the live canvas. The canvas
 * shows the drawing as it is being worked on, at the current zoom,
 * with handles, hover and selection highlights; none of that belongs
 * in a file someone is going to print or hand in. Here the camera is
 * chosen for the output instead, the selection is suppressed, and
 * the result is an SVG that the raster formats are then drawn from.
 */
import enggDrawingState from "../core/model/drawing-state.js";
import enggDrawingRenderer from "../rendering/renderer.js";

/*
 * The margin left around the drawing, as a fraction of its own
 * size.
 *
 * Without it the outermost arrowhead and dimension text sit exactly
 * on the edge of the image, where a printer's unprintable margin
 * takes them. A tenth of the drawing on each side is enough to keep
 * the whole of it on the page without making the drawing small.
 */
const MARGIN_RATIO = 0.1;

/*
 * A floor on the drawn size.
 *
 * A drawing made of a single small feature is only a few
 * millimetres across in world units, and rendering it at its true
 * size would produce an image too small to read or too small for
 * a printer to accept. This keeps the output usable whatever the
 * drawing's extent.
 */
const MIN_OUTPUT_PX = 600;

const DEFAULT_OUTPUT_PX = 1600;

/*
 * The size of the page a Print is composed onto, in CSS pixels at the
 * nominal print resolution.
 *
 * It is NOT the editor canvas and NOT the screen: it is the paper the
 * browser print dialog is given. A4 landscape at 96 CSS pixels per
 * inch (1123 x 794) is the office default, and a drawing scaled to it
 * proportionally is what a printer receives. Because the camera is
 * computed from this rectangle rather than from anything on screen,
 * the printed page is the same whatever the window, the monitor and
 * the zoom were.
 */
const PRINT_PAGE_PX = { width: 1123, height: 794 };

/*
 * The world-space extent of the drawing as it is DRAWN, not as it
 * is stored.
 *
 * This matters more than it sounds. A force's stored end is a
 * point, but the arrowhead is drawn beyond it; a load's arrows
 * stand off its body; a dimension's text sits outside what it
 * measures. Bounding the stored geometry would crop all of that
 * off, which is the single most common way an exported drawing
 * comes out wrong. The caller supplies the bounds because only it
 * knows how each feature type is rendered.
 */
function paddedBounds(points, width, height) {
  if (!points || !points.length) {
    return null;
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const point of points) {
    if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) {
      continue;
    }

    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }

  if (!Number.isFinite(minX)) {
    return null;
  }

  const spanX = Math.max(maxX - minX, 1e-6);
  const spanY = Math.max(maxY - minY, 1e-6);

  const marginX = spanX * MARGIN_RATIO;
  const marginY = spanY * MARGIN_RATIO;

  return {
    minX: minX - marginX,
    minY: minY - marginY,
    maxX: maxX + marginX,
    maxY: maxY + marginY,
    width: width || DEFAULT_OUTPUT_PX,
    height: height || DEFAULT_OUTPUT_PX
  };
}

/*
 * The camera that fits a given world rectangle into a given pixel
 * size.
 *
 * The camera is a model the renderer already understands, so an
 * export is the ordinary renderer with a different camera. That is
 * what keeps the export honest: it cannot drift from what the
 * editor draws, because it is the same code drawing it.
 */
function cameraFor(bounds) {
  const scale =
    enggDrawingState.BASE_PIXELS_PER_UNIT;

  const worldWidth = Math.max(
    bounds.maxX - bounds.minX,
    1e-6
  );

  const worldHeight = Math.max(
    bounds.maxY - bounds.minY,
    1e-6
  );

  const zoom =
    Math.min(
      bounds.width / (worldWidth * scale),
      bounds.height / (worldHeight * scale)
    );

  /*
   * The centre of the drawing, expressed in the camera's terms:
   * the renderer places a point at
   *
   *   width / 2 + (x - pan) * scale * zoom
   *
   * so a pan of the drawing's centre puts that centre in the
   * middle of the output.
   */
  return {
    zoom: Math.max(zoom, 1e-6),
    panX: (bounds.minX + bounds.maxX) / 2,
    panY: (bounds.minY + bounds.maxY) / 2
  };
}

/*
 * ========================================================
 * THE SHARED FIT ENGINE
 * ========================================================
 *
 * One piece of mathematics, used by Fit Whole Page, Fit
 * Selected, the export and the Drawing Reference.
 *
 * It was tempting to let Fit compute its own zoom, since the
 * editor has a canvas and an export has an image and they look
 * like different jobs. They are not: all four are the same
 * question - given a world-space rectangle and a pixel viewport,
 * what camera shows that rectangle? The answer does not depend on
 * who asked, and having each of them work it out separately is how
 * a Fit and an export end up framing the same drawing differently
 * while both look correct in isolation.
 *
 * So the two steps are named and separated here:
 *
 *   getRenderableBounds(target)  what is actually visible
 *   fitBoundsIntoViewport(...)    what camera shows it
 *
 * and the callers supply the bounds from whichever source of truth
 * they have. Fit passes the editor's rendered bounds, the export
 * passes the same ones for the same objects. The second step
 * cannot differ between them, which is the point.
 */

/*
 * The screen-space margin, as a fraction of the viewport.
 *
 * A RATIO of the viewport, not a fixed number of world units, and
 * that distinction is the whole reason it is written this way.
 *
 * A fixed world margin behaves differently at different scales,
 * which is the fault the specification calls out: a 5mm margin
 * around a 200mm beam is a comfortable 2.5%, while the same 5mm
 * around a 2000mm truss is invisible, and around a 20mm detail it
 * swallows the drawing. A margin that is always the same share of
 * the canvas looks the same whatever is being fitted, and it
 * automatically shrinks and grows with zoom.
 *
 * It is less than one so the drawing is inset rather than touching
 * the edges. A drawing fitted edge to edge looks fitted but reads
 * as cropped, and the first thing anyone does after a Fit is nudge
 * or scroll something, which is easier with a little space showing.
 */
const FIT_MARGIN_RATIO = 0.85;

/*
 * The world-space rectangle that a set of points occupies.
 *
 * The bare union, with no margin applied. Keeping this separate
 * from the margin is what lets the same rectangle be reported
 * honestly to a caller that wants to know how big the drawing
 * really is, rather than how big it is once it has been padded.
 */
function unionBounds(points) {
    if (!points || !points.length) {
        return null;
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const point of points) {
        if (
            !Number.isFinite(point?.x) ||
            !Number.isFinite(point?.y)
        ) {
            continue;
        }

        minX = Math.min(minX, point.x);
        minY = Math.min(minY, point.y);
        maxX = Math.max(maxX, point.x);
        maxY = Math.max(maxY, point.y);
    }

    if (!Number.isFinite(minX)) {
        return null;
    }

    return { minX, minY, maxX, maxY };
}

/*
 * The camera that shows a world rectangle inside a pixel viewport.
 *
 * Returns null when there is nothing to show, so the caller can
 * answer for an empty sheet rather than being handed a camera
 * built from a division by zero. Returning null rather than a
 * default is the important part: it keeps "there is nothing here"
 * distinguishable from "here is a very small thing", which are
 * different answers and which used to be conflated.
 *
 * The zoom is ONE number applied to both axes, so the drawing's
 * proportions are never changed. Fitting is not resizing: the
 * aspect ratio of the drawing is the aspect ratio it was drawn
 * with, and a fit that stretched one axis independently would be a
 * distortion dressed up as a convenience.
 *
 * A rectangle with no extent in one direction - a single point, or
 * a perfectly horizontal line - cannot be divided by, so that axis
 * is not fitted against. The other axis decides the zoom and the
 * flat axis is simply centred, which is what "fit this line"
 * should mean. A 1e-6 floor would not fix that: dividing the
 * canvas by a millionth gives a magnification of millions, which
 * is not a view anyone can draw in.
 */
function fitBoundsIntoViewport(
    rectangle,
    viewport
) {
    if (!rectangle) {
        return null;
    }

    const width = Number(viewport?.width);
    const height = Number(viewport?.height);

    if (
        !Number.isFinite(width) ||
        !Number.isFinite(height) ||
        width <= 0 ||
        height <= 0
    ) {
        return null;
    }

    const spanX = rectangle.maxX - rectangle.minX;
    const spanY = rectangle.maxY - rectangle.minY;

    const usableWidth = width * FIT_MARGIN_RATIO;
    const usableHeight = height * FIT_MARGIN_RATIO;

    const scale = enggDrawingState.BASE_PIXELS_PER_UNIT;

    const zoomX =
        Number.isFinite(spanX) && spanX > 0
            ? usableWidth / (spanX * scale)
            : Infinity;

    const zoomY =
        Number.isFinite(spanY) && spanY > 0
            ? usableHeight / (spanY * scale)
            : Infinity;

    const zoom = Math.min(zoomX, zoomY);

    if (
        !Number.isFinite(zoom) ||
        zoom <= 0
    ) {
        return null;
    }

    return {
        /*
         * The CENTRE of the rectangle, not its corner. The
         * renderer places a point at
         *
         *   width / 2 + (x - pan) * scale * zoom
         *
         * so a pan of the centre puts the centre of the drawing
         * in the middle of the viewport, which is what a fit is
         * for. Anchoring on the minimum instead is the other
         * common reading of "fit", and it leaves the drawing in
         * the corner with all the empty space on one side.
         */
        zoom,
        panX: (rectangle.minX + rectangle.maxX) / 2,
        panY: (rectangle.minY + rectangle.maxY) / 2
    };
}

/*
 * Render the document to an SVG element, fitted to its own bounds.
 *
 * The selection is suppressed for the duration, because selection
 * highlights and manipulation handles are part of editing the
 * drawing rather than part of the drawing. They are restored
 * afterwards so the editor is left exactly as it was found.
 */
function renderClean(state, bounds) {
  const camera = cameraFor(bounds);

  const previousCamera = { ...state.camera };
  const previousSelection = [...state.selection.selectedObjectIds];
  const previousHovered = state.selection.hoveredObjectId;

  /*
   * THE CONSTRUCTION IS SUPPRESSED WITH THE SELECTION.
   *
   * The renderer reads the live interaction to draw the half-built
   * thing: the tool's preview, the snap marker, the guide line, the
   * box being dragged. None of that is drawing content, and an output
   * taken while a feature is being created must show only what is
   * committed. An idle interaction is what the editor holds between
   * tools, so a blank one is the honest "nothing is being drawn" state.
   *
   * It is restored with the camera and the selection, so a Print taken
   * mid-construction returns the user exactly where they were.
   */
  const previousInteraction = state.interaction;

  state.interaction = { phase: "idle" };

  state.camera.zoom = camera.zoom;
  state.camera.panX = camera.panX;
  state.camera.panY = camera.panY;

  state.selection.selectedObjectIds = [];
  state.selection.hoveredObjectId = null;

  /*
   * A detached canvas of the output size, so the render is
   * independent of the editor's viewport entirely. The browser
   * window's size, the current zoom and the panels on screen have
   * no effect on what comes out.
   */
  const host = document.createElement("div");

  host.style.position = "absolute";
  host.style.left = "-10000px";
  host.style.top = "0";
  host.style.width = `${bounds.width}px`;
  host.style.height = `${bounds.height}px`;
  host.style.background = "#ffffff";

  const canvas = document.createElement("div");

  canvas.className = "drawing-canvas";
  canvas.style.width = `${bounds.width}px`;
  canvas.style.height = `${bounds.height}px`;

  host.appendChild(canvas);
  document.body.appendChild(host);

  let svg;

  try {
    enggDrawingRenderer.renderDrawing(
      state,
      canvas
    );

    svg = canvas.querySelector("svg");
  } finally {
    host.remove();

    state.interaction = previousInteraction;
    state.camera.zoom = previousCamera.zoom;
    state.camera.panX = previousCamera.panX;
    state.camera.panY = previousCamera.panY;
    state.selection.selectedObjectIds = previousSelection;
    state.selection.hoveredObjectId = previousHovered;
  }

  if (!svg) {
    return null;
  }

  /*
   * The rendered SVG carries the editor's own layout styling, which
   * means nothing outside it. The size and a plain white
   * background are stated here so the file stands on its own.
   *
   * THE SIZE IS STATED AS AN INLINE STYLE, NOT ONLY AS AN ATTRIBUTE.
   *
   * The host this SVG was drawn into is removed before it is returned, so the
   * SVG is left with NO PARENT - and a detached element with only `width` and
   * `height` ATTRIBUTES is still open to being sized by any CSS rule that
   * matches it. The renderer's own `.drawing-canvas svg { width: 100% }` did
   * exactly that: with no parent to resolve against, the percentage resolved
   * against the VIEWPORT, and a figure asked for at 760x460 came out at the
   * window's size - 1280x775 - sitting at the top-left of the page.
   *
   * An inline style is the strongest statement a page can make about an
   * element's own size, so the figure keeps the size it was rendered at
   * wherever it is placed afterwards.
   */
  svg.setAttribute(
    "width",
    String(bounds.width)
  );
  svg.setAttribute(
    "height",
    String(bounds.height)
  );
  svg.setAttribute(
    "viewBox",
    `0 0 ${bounds.width} ${bounds.height}`
  );

  /*
   * The width is stated in PIXELS and the height is left to the aspect ratio,
   * which is what lets a figure scale down to a narrow pane without distorting:
   * a fixed pixel height would keep the drawing at its rendered size and
   * overflow instead.
   */
  svg.style.width = `${bounds.width}px`;
  svg.style.maxWidth = "100%";
  svg.style.height = "auto";
  svg.style.background = "#ffffff";

  return svg;
}

/*
 * Supplies the points the drawing is drawn through.
 */
let boundsProvider = null;

/*
 * Every point the drawing is drawn through, across all features.
 *
 * This is what an output is fitted to. The provider is the editor's
 * own rendered-bounds calculation, so an export cannot disagree
 * with the editor about how large a feature is.
 */
function drawnPoints() {
  if (!boundsProvider) {
    return [];
  }

  return boundsProvider() || [];
}

/*
 * The registered provider, for tests.
 *
 * Exposed so a test can ask "how big is THIS feature" through exactly the code
 * the Fit runs, rather than through a second measurement that could disagree
 * with it. It is a read-only view of one function reference.
 */
function boundsProviderForTest() {
  return boundsProvider;
}

/*
 * Render a raster image of the document.
 *
 * The SVG is the source in every case, including JPG. A JPG is not
 * produced by capturing the screen or by redrawing into a second
 * renderer; it is the same drawing the PNG is, encoded
 * differently. JPG also has no transparency, so it is filled with
 * white first - otherwise every part of the page the drawing does
 * not cover would come out black.
 */
function renderImage(state, points, options = {}) {
  /*
   * Points are normally taken from the provider, which is what the
   * editor draws rather than what it stores. A caller may pass
   * its own for a specific purpose, but the default is the
   * authoritative one.
   */
  const extent =
    points && points.length ? points : drawnPoints();

  const bounds = paddedBounds(
    extent,
    options.width || DEFAULT_OUTPUT_PX,
    options.height || DEFAULT_OUTPUT_PX
  );

  if (!bounds) {
    return null;
  }

  const svg = renderClean(state, bounds);

  if (!svg) {
    return null;
  }

  /* A caller that only needs the drawing (the LaTeX writer) skips the raster. */
  if (options.svgOnly) {
    return { svg, bounds };
  }

  const canvas = document.createElement("canvas");

  canvas.width = Math.round(bounds.width);
  canvas.height = Math.round(bounds.height);

  const context = canvas.getContext("2d");

  if (options.background) {
    context.fillStyle = options.background;
    context.fillRect(0, 0, canvas.width, canvas.height);
  }

  return {
    svg,
    canvas,
    context,
    bounds
  };
}

/*
 * ========================================================
 * A FITTED PREVIEW OF A STORED DOCUMENT
 * ========================================================
 *
 * The one way anything that is NOT the open editor draws a drawing: a Recent
 * file's thumbnail, a template's card, and the figure a written solution
 * inserts.
 *
 * WHY IT IS A SEPARATE PATH, AND WHY THAT MATTERS
 * -----------------------------------------------
 * The editor's own bounds measure the LIVE document - the open sheet, at the
 * editor's zoom, with the current Visual Force Scale. That is right for Fit and
 * for a print of what is on screen. It is wrong for a stored drawing, and it is
 * the reason a thumbnail could come out showing the whole workspace with a tiny
 * figure in one corner: the bounds and the render were read from different
 * places, and a calibrated or scaled sheet made them disagree.
 *
 * So this builds its OWN read-only state from the stored document - its sheets,
 * its World Scale, a neutral camera - measures the bounds against THAT, and
 * renders fitted. Nothing about the open document is read, and nothing about it
 * is changed: the same call produces the same picture whatever the student
 * happens to be looking at.
 */
function renderFittedDocument(documentBody, options = {}) {
  const sheets = documentBody?.sheets || [];

  const active =
    sheets.find((sheet) => sheet.id === documentBody?.activeSheetId) ||
    sheets[0] ||
    null;

  if (!active) {
    return null;
  }

  const objects = active.objects || [];

  if (!objects.length) {
    return null;
  }

  /*
   * The read-only state the renderer draws. It carries the sheet's OWN scale
   * and units, so a calibrated drawing is measured and drawn in its own frame
   * rather than in the open document's.
   */
  const state = {
    objects,
    scale: active.scale || null,
    units: active.units || documentBody.units || "mm",
    camera: { zoom: 1, panX: 0, panY: 0 },
    selection: {
      selectedObjectIds: [],
      boxSelectionIds: [],
      hoveredObjectId: null
    },
    interaction: { phase: "idle" }
  };

  const points = boundsProvider
    ? boundsProvider(objects, 1)
    : [];

  if (!points.length) {
    return null;
  }

  /*
   * THE BOX IS THE DRAWING'S SHAPE, NOT A FIXED PAGE.
   *
   * `renderImage` fills a page of the size it is given, and with only a width
   * supplied the height falls back to the printed-page default - so a thumbnail
   * was drawn into a 160x1600 box with the figure adrift in the middle of a
   * great deal of empty space. That is the "thumbnail shows the whole
   * workspace" defect, and no amount of correct fitting inside the box fixes
   * it: the box itself has to match the drawing.
   *
   * So the height is derived from the drawing's own extent, clamped to a sane
   * range. The aspect ratio is preserved (the fit engine does that), and the
   * picture now fills its card.
   */
  const width = Math.max(Number(options.width) || 160, 16);

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  points.forEach((point) => {
    if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) {
      return;
    }

    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  });

  const spanX = Math.max(maxX - minX, 1e-6);
  const spanY = Math.max(maxY - minY, 1e-6);

  const aspect = spanX / spanY;

  const height = Math.max(
    16,
    Math.min(Math.round(width / aspect), width * 4)
  );

  return renderImage(state, points, {
    width,
    height: options.height || height,
    background: options.background || null,
    svgOnly: Boolean(options.svgOnly)
  });
}

const enggDrawingExport = {
  DEFAULT_OUTPUT_PX,
  FIT_MARGIN_RATIO,
  MARGIN_RATIO,
  MIN_OUTPUT_PX,
  PRINT_PAGE_PX,

  /*
   * The shared fit engine. Exposed so Fit Whole Page, Fit
   * Selected, the export and the Drawing Reference all ask the same
   * question the same way.
   */
  unionBounds,
  fitBoundsIntoViewport,

  boundsProviderForTest,
  cameraFor,
  drawnPoints,
  paddedBounds,
  renderClean,
  renderFittedDocument,
  renderImage,

  /*
   * How the module learns what a feature occupies on screen.
   *
   * Only the editor knows how each feature type is RENDERED - how
   * far a force's arrowhead reaches past its stored end, how far a
   * load's arrows stand off its body - so that calculation lives
   * there and is supplied here. This keeps the module about
   * turning bounds into pixels, and keeps the knowledge of what a
   * feature looks like in the one place that renders it.
   *
   * Without it an output would fall back to stored geometry and
   * crop every arrowhead off the drawing, which is the most common
   * way an exported drawing comes out wrong.
   */
  setBoundsProvider(provider) {
    boundsProvider =
      typeof provider === "function" ? provider : null;
  }
};

export default enggDrawingExport;

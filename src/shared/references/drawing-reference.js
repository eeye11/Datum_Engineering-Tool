/*
 * Drawing references: one part of the application pointing at a sheet.
 *
 * A reference is not a picture of a drawing. It is a note that says
 * "put sheet sheet_8f31a here", and the drawing is rendered from that
 * sheet's CURRENT contents every time it is looked at.
 *
 * WHY IT IS NOT A COPY
 * --------------------
 * The obvious way to put a drawing into a document is to export it and
 * paste the image. That is wrong here for a reason that is easy to miss:
 * the student is still editing the drawing. An exported image is a
 * photograph of a moment - move the load two millimetres and the
 * figure in the solution is silently, permanently wrong, and there is
 * nothing in either file that knows they were ever related. Every
 * re-export is another chance to forget.
 *
 * So the reference stores a sheetId and nothing else of substance. The
 * chain is:
 *
 *     written reference -> sheetId -> current sheet -> render
 *
 * and the middle step is looked up at render time, so it cannot go
 * stale. Editing the beam updates the figure. Renaming the sheet does
 * not break the figure, because the figure never knew the name.
 * Reordering the tabs does not break it either, because the reference
 * is not a position. What it depends on is exactly one thing - the id -
 * and an id is permanent by design.
 *
 * WHY displayMode EXISTS
 * ---------------------
 * A reference has to say how much of the sheet to show. "fit" is the
 * default and the honest one: it measures the drawing and shows all
 * of it, so the figure matches the sheet however the student happens
 * to be looking at it in the editor. A sheet zoomed to 250% on a
 * detail still prints the whole drawing in the figure, because the
 * figure is a statement about the DRAWING, not about the view.
 *
 * More modes - a fixed scale, a crop, a figure number - can be added
 * without touching the architecture, because the id is what is stored
 * and the mode is only ever consulted while rendering.
 */
import enggDrawingState from "../model/drawing-state.js";
import enggDrawingExport from "../file/document-export.js";

/*
 * The shape a reference is stored in.
 *
 * referenceId is its own identity so that a document can talk about
 * "that figure" before it has decided where it goes. sheetId is the
 * only field that means anything: everything else is presentation.
 */
function createReference(options = {}) {
  return {
    referenceId:
      options.referenceId || newReferenceId(),
    type: "drawingReference",
    sheetId: options.sheetId || null,
    displayMode: options.displayMode || "fit",
    caption:
      options.caption !== undefined
        ? options.caption
        : null
  };
}

function newReferenceId() {
  const random =
    globalThis.crypto &&
    typeof globalThis.crypto.randomUUID === "function"
      ? globalThis.crypto.randomUUID().replace(/-/g, "")
      : Math.random().toString(16).slice(2) +
        Math.random().toString(16).slice(2);

  return `ref_${random.slice(0, 8)}`;
}

/*
 * The text form, for the written side's source.
 *
 * A written document is text, so a reference has to be expressible
 * in text. This is the placeholder for what will eventually be a
 * real command:
 *
 *     \enggdiagram{sheet_8f31a}
 *
 * The id is inside the braces, not a name and not a number, which
 * is the same decision in both forms: the token survives renaming
 * and reordering because it never mentions either.
 */
const TOKEN_PATTERN =
  /\[DRAWING_REFERENCE:([A-Za-z0-9_-]+)\]/g;

function serializeReference(reference) {
  if (!reference?.sheetId) {
    return "";
  }

  return `[DRAWING_REFERENCE:${reference.sheetId}]`;
}

function parseReferences(text) {
  const found = [];
  const source = String(text || "");

  TOKEN_PATTERN.lastIndex = 0;

  let match = TOKEN_PATTERN.exec(source);

  while (match) {
    found.push({
      sheetId: match[1],
      index: match.index,
      length: match[0].length
    });

    match = TOKEN_PATTERN.exec(source);
  }

  return found;
}

/*
 * How the reference system finds sheets and measures them.
 *
 * Supplied by the editor, because the editor is what holds the
 * collection and what knows how a feature is RENDERED. This module
 * must not need either: the point of it being reusable is that the
 * written solution can ask for a figure without knowing anything
 * about the document model.
 */
let sheetResolver = null;
let boundsProvider = null;

function configure({ getSheet, getRenderedPoints } = {}) {
  if (typeof getSheet === "function") {
    sheetResolver = getSheet;
  }

  if (typeof getRenderedPoints === "function") {
    boundsProvider = getRenderedPoints;
  }
}

/*
 * Render a sheet as a clean drawing.
 *
 * The steps are the same ones an export takes, and deliberately so:
 *
 *   1. find the sheet BY ITS ID
 *   2. take its current features
 *   3. measure them AS DRAWN - arrowheads, load profiles, dimension
 *      text - so nothing that will be shown can fall outside the
 *      frame
 *   4. fit a camera to those bounds
 *   5. render with the ordinary renderer, with selection suppressed
 *
 * Step 5 is what keeps a figure honest. There is no second renderer
 * for references, so a figure cannot disagree with the editor about
 * what a feature looks like. It also means the figure inherits the
 * sheet's own grid state for free, because the grid is part of what
 * the renderer draws from the state it is given - see
 * renderEngineeringGrid, which reads grid.visible and refuses to
 * draw a line otherwise.
 *
 * What it deliberately excludes: no toolbar, no menus, no Features
 * panel, no sheet tabs, no selection handles, no snap markers, no
 * in-progress tool. The render is into a detached element that is
 * thrown away, so there is no application UI anywhere near it.
 */
function renderDrawingReference(sheetId, options = {}) {
  if (!sheetResolver) {
    return null;
  }

  const sheet = sheetResolver(sheetId);

  if (!sheet) {
    /*
     * A reference to a sheet that is not there is a real state -
     * a sheet can be deleted, and a document may arrive from
     * somewhere that never had it. It is reported rather than
     * thrown, so one missing figure does not stop a document from
     * rendering the rest.
     */
    return {
      ok: false,
      reason: "missing-sheet",
      sheetId,
      svg: null
    };
  }

  const points =
    typeof boundsProvider === "function"
      ? boundsProvider(sheet.objects || []) || []
      : [];

  /*
   * A sheet that GENUINELY has nothing on it, as distinct from a
   * sheet whose content the bounds provider failed to measure.
   *
   * These two were conflated, and conflating them is what produced
   * "Sheet 1 - this sheet is empty" over a sheet full of geometry.
   * If measurement returns no points, the obvious reading is that the
   * sheet is blank - and the figure then confidently asserted
   * something false, in a document meant to be evidence.
   *
   * So the question is asked of the SHEET itself, which is the only
   * thing that can actually answer it. If the sheet HAS features and
   * measurement produced nothing, that is a fault in the measurement,
   * and it is reported as one rather than papered over with a claim
   * that the sheet is empty.
   */
  const hasContent = (sheet.objects || []).length > 0;

  if (!points.length && hasContent) {
    return {
      ok: false,
      reason: "unmeasured",
      sheetId,
      sheet,
      featureCount: (sheet.objects || []).length,
      caption: captionFor(sheet, options),
      svg: null
    };
  }

  if (!points.length) {
    /*
     * An empty sheet has nothing to fit. A blank frame with its
     * caption is a better answer than an empty page: the reader can
     * see that a figure was meant to be here.
     */
    return {
      ok: true,
      empty: true,
      sheet,
      caption: captionFor(sheet, options),
      svg: null
    };
  }

  const width = options.width || 900;
  const height = options.height || 600;

  const bounds = enggDrawingExport.paddedBounds(
    points,
    width,
    height
  );

  /*
   * The same distinction again. Bounds that could not be computed for
   * a sheet that HAS features is a failure of the fit, not an empty
   * sheet, and is reported as one.
   */
  if (!bounds && hasContent) {
    return {
      ok: false,
      reason: "unbounded",
      sheetId,
      sheet,
      featureCount: (sheet.objects || []).length,
      caption: captionFor(sheet, options),
      svg: null
    };
  }

  if (!bounds) {
    return {
      ok: true,
      empty: true,
      sheet,
      caption: captionFor(sheet, options),
      svg: null
    };
  }

  /*
   * A state that exists only for this render.
   *
   * Rendering the live editor state would work right up until the
   * sheet being referenced happened to be the one on screen, and
   * then the figure would contain whatever the student was halfway
   * through drawing. A detached state built from the sheet's own
   * content makes that impossible: a reference renders the sheet,
   * or it does not render.
   */
  const renderState = createRenderState(sheet, bounds);

  const svg = enggDrawingExport.renderClean(
    renderState,
    bounds
  );

  return {
    ok: Boolean(svg),
    sheet,
    bounds,
    svg,
    caption: captionFor(sheet, options),
    displayMode: renderState.__displayMode
  };
}

/*
 * A throwaway editor state describing one sheet, framed by a camera.
 *
 * Built rather than borrowed, because the camera is chosen here - it
 * is the fit, not the student's current zoom - and because the grid
 * must come from the SHEET rather than from whatever the editor
 * currently has set.
 */
function createRenderState(sheet, bounds) {
  const state =
    enggDrawingState.createDrawingState();

  state.units = sheet.units;
  state.objects = JSON.parse(
    JSON.stringify(sheet.objects || [])
  );

  state.grid = { ...(sheet.grid || {}) };

  state.snap = { ...(sheet.snap || state.snap) };

  state.styleDefaults = {
    ...(sheet.styleDefaults || state.styleDefaults)
  };

  const camera =
    enggDrawingExport.cameraFor(bounds);

  state.camera.zoom = camera.zoom;
  state.camera.panX = camera.panX;
  state.camera.panY = camera.panY;

  /*
   * "fit" is the only mode, and it is the default, and it is the
   * one that makes the reference independent of how the student
   * happens to be looking at the sheet in the editor. Stated on the
   * state so the value is visible where the render happens rather
   * than implied by the fact that there is only one branch.
   */
  state.__displayMode = "fit";

  return state;
}

/*
 * What the figure is called.
 *
 * The caption is chosen by whoever holds the reference, and falls
 * back to the sheet's CURRENT name - so a figure that was inserted
 * before the sheet was renamed keeps up with the rename, without
 * the reference itself ever having read the name it was created
 * with.
 */
function captionFor(sheet, options) {
  if (options && options.caption !== undefined) {
    return options.caption;
  }

  return sheet?.name || "";
}

const enggDrawingReference = {
  configure,
  createReference,
  parseReferences,
  renderDrawingReference,
  serializeReference
};

export default enggDrawingReference;

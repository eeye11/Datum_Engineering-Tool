/*
 * ============================================================
 * INLINE TEXT ENTRY
 * ============================================================
 *
 * The geometry behind the inline node-entry prompt: "where, in the window, is
 * the node the student is about to write?"
 *
 * IT IS GEOMETRY ONLY. The prompt itself - its field, its keys, its commit and
 * cancel - lives in `note-editor.js`. This module answers the three questions
 * that prompt needs and that the canvas already knows the answers to:
 *
 *   worldToClient(point)          a drawing-space point, in window pixels
 *   modelPointForTextEntry(object) where an object's text sits, in the model
 *   resolveTextEntryAnchor(host)  the canvas point to hang the prompt on
 *
 * WHY IT IS NOT IN THE EDITOR. The editor is a DOM component and must not
 * reach into the drawing state, the viewport or the model. Keeping the
 * projection here means the editor can be exercised with a plain anchor
 * rectangle, and the projection can be tested against a real camera without a
 * document at all.
 *
 * THE ONE TRANSFORMATION. The canvas stores geometry in drawing units and the
 * viewport shows `BASE_PIXELS_PER_UNIT x zoom` pixels per unit, centred on
 * `camera.pan`. `screenToEngineering` / `engineeringToScreen` in
 * `drawing-state.js` are that transformation, and this module calls them rather
 * than repeating the arithmetic - so the prompt sits on the node at every zoom
 * and pan, and cannot drift from where the node is actually drawn.
 *
 * THE ONE IMPORT IS THE STATICS LABEL PLACEMENT, which itself imports nothing -
 * so this module still runs on its own and the editor can use it without
 * dragging the model in.
 */
import enggStaticsLabel from "../../geometry/statics-label.js";

/* The DOM element the drawing is painted into. */
export function canvasElement() {
  const element =
    globalThis.document?.querySelector?.(".drawing-canvas") ||
    globalThis.document?.getElementById?.("canvas");

  return element || null;
}

/* The pixel box of the canvas, or null when there is no canvas in the page. */
export function canvasBounds(element = canvasElement()) {
  if (!element || typeof element.getBoundingClientRect !== "function") {
    return null;
  }

  const rect = element.getBoundingClientRect();

  /*
   * A canvas that has not been laid out yet has no box. Measuring one anyway
   * would put the prompt at the window's top-left corner, so the caller is told
   * instead and falls back to a screen-fixed position.
   */
  if (!rect || (!rect.width && !rect.height)) {
    return null;
  }

  const width = Number(element.clientWidth) || rect.width;
  const height = Number(element.clientHeight) || rect.height;

  return { rect, width, height };
}

/*
 * A point in the camera's own frame.
 *
 * `camera` is `{ zoom, panX, panY }`; `size` is the canvas's client size. The
 * third and fourth arguments exist so this can be used with no drawing state at
 * all - a test, or a caller holding a saved viewport.
 */
export function createProjection(camera, size, basePixelsPerUnit = 3.6) {
  const c = camera || {};
  const zoom = Number(c.zoom) || 1;
  const panX = Number(c.panX) || 0;
  const panY = Number(c.panY) || 0;
  const width = Number(size?.width) || 0;
  const height = Number(size?.height) || 0;
  const scale = (Number(basePixelsPerUnit) || 3.6) * zoom;

  return {
    scale,
    toPixels(point) {
      return {
        x: width / 2 + (Number(point?.x) - panX) * scale,
        y: height / 2 - (Number(point?.y) - panY) * scale,
      };
    },
    toWorld(point) {
      return {
        x: (Number(point?.x) - width / 2) / scale + panX,
        y: (height / 2 - Number(point?.y)) / scale + panY,
      };
    },
  };
}

/* Where the probe is when no camera can be read - the canvas's own centre. */
function centreOf(bounds) {
  return { x: bounds.width / 2, y: bounds.height / 2 };
}

/*
 * THE WINDOW POSITION OF A DRAWING POINT.
 *
 * Returns `{ x, y, scale }` in client (window) pixels - the frame a
 * `position: fixed` prompt is placed in - or `{ ...centre, scale: 1 }` when
 * there is no canvas or no state to project with.
 */
export function worldToClient(point, options = {}) {
  const bounds = options.bounds || canvasBounds(canvasElement());

  if (!bounds) {
    return { x: 0, y: 0, scale: 1 };
  }

  const state = options.state || null;
  const camera = options.camera || state?.camera || {};
  const projection = createProjection(
    camera,
    bounds,
    options.basePixelsPerUnit,
  );

  const local = projection.toPixels(point || centreOf(bounds));

  return {
    x: bounds.rect.left + local.x,
    y: bounds.rect.top + local.y,
    scale: projection.scale,
  };
}

/*
 * THE SAME PROJECTION, IN THE CANVAS'S OWN PIXEL FRAME.
 *
 * `worldToClient` answers in WINDOW pixels, which is what a `position: fixed`
 * prompt needs. An editing field that is a CHILD of the canvas needs the point
 * in the canvas's own space instead - the canvas's top-left as (0,0).
 *
 * THE TWO FRAMES ARE NOT INTERCHANGEABLE, and treating one as the other is what
 * put every text field at the canvas's own offset from the word it was editing:
 * the box was positioned with window coordinates inside a canvas-local frame, so
 * it sat exactly `rect.left` and `rect.top` away from the caret. One projection,
 * asked for the frame it is needed in.
 */
export function worldToCanvas(point, options = {}) {
  const bounds = options.bounds || canvasBounds(canvasElement());

  if (!bounds) {
    return { x: 0, y: 0, scale: 1 };
  }

  const state = options.state || null;
  const camera = options.camera || state?.camera || {};
  const projection = createProjection(
    camera,
    bounds,
    options.basePixelsPerUnit,
  );

  const local = projection.toPixels(point || centreOf(bounds));

  return { x: local.x, y: local.y, scale: projection.scale };
}

/*
 * Watch a camera change.
 *
 * The teacher's rule is that the prompt must stay ON the node - so when the
 * student zooms or pans while the field is open, the prompt follows. The
 * camera is not observable, so the caller supplies a subscribe function that
 * calls back on every camera change, and this only wraps it: a caller with no
 * such signal gets a prompt that is placed once and left alone, which is the
 * behaviour every non-canvas caller needs anyway.
 */
export function followCamera(subscribe, listener) {
  if (typeof subscribe !== "function" || typeof listener !== "function") {
    return () => {};
  }

  const unsubscribe = subscribe(listener);

  return typeof unsubscribe === "function" ? unsubscribe : () => {};
}

/* ============================================================
 * WHERE AN OBJECT'S TEXT SITS
 * ============================================================
 *
 * A note's text is at its placement; a leader's and a callout's is at the far
 * end of the pen; a label's is at its placement, which starts at its anchor and
 * may have been moved away. Those are the model's own positions - the same ones
 * `annotation-render.js` reads - so the prompt appears where the words will
 * actually be drawn.
 *
 * An object with no text position at all (a dimension's placement, a label
 * carried by a beam) falls back to whatever point the model does have, then to
 * the middle of its geometry. Returning null means "nothing to anchor on", and
 * the caller then opens the prompt at a fixed corner instead of guessing.
 */
function finitePoint(value) {
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
 * THE DIMENSION'S TEXT POSITION, FROM THE MODEL.
 *
 * Reached by name on the installed model (the same way every other cross-
 * layer reader in this codebase reaches it), so this module stays free of an
 * import cycle with the drawing model and still reads the ONE derivation of
 * where a dimension's number is.
 */
function dimensionTextAnchor(object) {
  const model =
    object?.__dimensionModel ||
    globalThis.enggDimensionModel ||
    null;

  if (!model || typeof model.graphicsFor !== "function") {
    return null;
  }

  const state = globalThis.enggDrawingState;

  try {
    const graphics = model.graphicsFor(object, state);
    const frame = graphics?.textFrame;

    return frame?.x !== undefined || frame?.y !== undefined
      ? { x: frame.x, y: frame.y }
      : finitePoint(frame?.center);
  } catch {
    return null;
  }
}

export function modelPointForTextEntry(object) {
  if (!object || typeof object !== "object") {
    return null;
  }

  /*
     * A STATICS OBJECT'S LABEL IS EDITED WHERE IT IS DRAWN.
     *
     * `statics-label.js` decides where a force's, a load's, a moment's or a
     * support's label sits - including any offset the student gave it - and the
     * renderer draws it there. The editor must open on those same glyphs, so it
     * asks the same module rather than a second, anchor-only rule that would put
     * the caret somewhere the words are not.
     */
  const staticsHome =
    enggStaticsLabel?.labelHomeOf
            ? enggStaticsLabel.labelHomeOf(object)
            : null;

  if (staticsHome) {
    return finitePoint(staticsHome);
  }

  const geometry = object.geometry || {};

  /*
   * A DYNAMICS SYMBOL'S LABEL IS AT ITS MIDDLE. Its terms are two terminals
   * and no placement, so a spring's prompt opens beside the coil rather than at
   * one end of it.
   *
   * THIS COMES AFTER THE WRITTEN KINDS, because a leader, a callout and an
   * arrow ALSO store `start` and `end` - and their text belongs at the far end
   * of the pen, not halfway along it.
   */
  const isDynamicsSymbol = Boolean(object.engineering?.dynamicsType);

  if (isDynamicsSymbol && geometry.start && geometry.end) {
    const start = finitePoint(geometry.start);
    const end = finitePoint(geometry.end);

    if (start && end) {
      return { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
    }
  }

  if (object.type === "annotation") {
    return finitePoint(object.placement) || finitePoint(geometry.position);
  }

  /*
   * A DIMENSION WRITES AT ITS NUMBER, NOT AT ITS PLACEMENT.
   *
   * The placement is the dimension LINE's point; the number stands off it, and
   * on a linear dimension it is not even at the same place. The inline prompt
   * must open over the glyphs the student clicked, so the point is the text
   * frame the model computed - the same one the renderer draws and the hit
   * test picks. The placement is the fallback for a dimension whose geometry
   * cannot be resolved, where there is no frame to point at.
   */
  if (object.type === "dimension") {
    const frame = dimensionTextAnchor(object);

    return (
      finitePoint(frame) ||
      finitePoint(object.placement) ||
      finitePoint(geometry.position)
    );
  }

  const kind = object.annotateKind;

  /*
   * A LEADER OR A CALLOUT WRITES AT ITS FAR END. The pen starts at the target
   * and ends where the text is; `end` is that end, and an unfinished one falls
   * back to the placement so the prompt never lands at the origin.
   */
  if (kind === "leader" || kind === "callout" || kind === "arrow") {
    return (
      finitePoint(geometry.end) ||
      finitePoint(geometry.position) ||
      finitePoint(geometry.start)
    );
  }

  const direct =
    finitePoint(geometry.position) ||
    finitePoint(geometry.start) ||
    finitePoint(geometry.point) ||
    finitePoint(geometry.center);

  return direct;
}

/* The viewport entry point: an object's text point, in window pixels. */
export function clientPointForObject(object, options = {}) {
  const world = modelPointForTextEntry(object);

  if (!world) {
    return null;
  }

  return worldToClient(world, options);
}

/* ============================================================
 * THE ANCHOR THE PROMPT HANGS ON
 * ============================================================
 *
 * The prompt is placed with `ui.js`'s `placeFloating`, which takes a
 * DOMRect-like anchor and the panel's size and keeps the panel on screen. So
 * the anchor is the node's position as a zero-size rect: the prompt opens just
 * below-right of the node, flips above or left when that would leave the
 * window, and is clamped when there is no room at all.
 *
 * `offset` is a small nudge in pixels. It keeps the first line of the node's
 * own text - the live preview - visible above the field rather than under it,
 * without moving the node itself: only the PROMPT is offset, never the model.
 */
/*
 * A ZERO-SIZE RECT AT THE TEXT'S OWN POINT - NO NUDGE.
 *
 * This used to default to `{ x: 10, y: 6 }`, a ten-pixel right and six-pixel
 * down nudge applied to EVERY label anchor. The editor then added its own four
 * pixels and a whole font size of lift on top, so the field sat well away from
 * the point the history text would occupy - and the words jumped when they were
 * committed.
 *
 * The rect is now the anchor exactly. A caller that genuinely needs an offset
 * passes one; the default belongs to the text, not beside it.
 */
export function anchorRectAt(point, offset = { x: 0, y: 0 }) {
  const x = Number(point?.x) || 0;
  const y = Number(point?.y) || 0;

  return {
    left: x + (Number(offset?.x) || 0),
    right: x + (Number(offset?.x) || 0),
    top: y + (Number(offset?.y) || 0),
    bottom: y + (Number(offset?.y) || 0),
    width: 0,
    height: 0,
    x: x + (Number(offset?.x) || 0),
    y: y + (Number(offset?.y) || 0),
  };
}

/*
 * THE CANVAS POINT AN ENTRY IS ABOUT, RESOLVED FROM AN OBJECT.
 *
 * Returns `{ point, rect }` or null. Null is the honest answer for an object
 * whose text place cannot be known (an unknown type with no geometry) and for a
 * page with no canvas - the prompt then opens at the viewport's centre rather
 * than claiming a place it does not know.
 */
export function resolveTextEntryAnchor(object, options = {}) {
  if (!object) {
    return null;
  }

  /*
   * THE ANCHOR IS PROJECTED INTO THE CANVAS'S OWN FRAME.
   *
   * The rect below says `frame: "canvas"`, and the editor relies on that: it
   * mounts the field INSIDE the canvas and places it with no offset arithmetic.
   * That is only true if the point is really canvas-local - and it was not.
   * `clientPointForObject` answers in WINDOW pixels, so a field placed from it
   * with no subtraction landed `rect.left` and `rect.top` away from its own
   * caret - the exact displacement every text tool showed.
   *
   * `worldToCanvas` is the same projection asked for the canvas frame, so the
   * frame the rect claims and the frame the point is in now agree.
   */
  const world = modelPointForTextEntry(object);

  const raw = world
    ? worldToCanvas(world, options)
    : options.point && finitePoint(options.point)
      ? worldToCanvas(options.point, options)
      : null;

  if (!raw) {
    return null;
  }

  return {
    point: raw,

    /*
     * THE RECT IS IN THE CANVAS'S OWN FRAME, and says so.
     *
     * `raw` is projected through the canvas's box, so it is already a point on
     * the drawing surface - `frame: "canvas"` is what tells the editor to mount
     * its field INSIDE the canvas rather than as a window overlay. The editor
     * then needs no offset arithmetic and the box cannot land off the sheet.
     */
    rect: { ...anchorRectAt(raw, options.offset), frame: "canvas" },
  };
}

/*
 * THE BOX'S DEFINITION, REACHABLE FROM A TEST.
 *
 * The field's dimensions are stated once, in `TEXT_ENTRY_BOX`, and this module
 * is what turns them into a window point for the editor. Re-exporting the
 * definition beside that conversion means a test can check the field against
 * the SAME numbers the drawing and its source are written from, rather than
 * against a second copy of them.
 */
export { TEXT_ENTRY_BOX, TEXT_ENTRY_BOX_PT } from "../../typography/canvas-typography.js";

export default {
  canvasElement,
  canvasBounds,
  createProjection,
  worldToClient,
  followCamera,
  modelPointForTextEntry,
  clientPointForObject,
  anchorRectAt,
  resolveTextEntryAnchor,
};

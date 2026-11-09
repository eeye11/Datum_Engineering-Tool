/*
 * ============================================================
 * THE PLACEMENT SESSION
 * ============================================================
 *
 * The step between "the student pressed Apply" and "the sketch is on the
 * page". A finished sketch is held here, attached to the cursor, until the
 * student clicks where it belongs.
 *
 * WHY IT IS A SESSION AND NOT A COMMIT
 * ------------------------------------
 *
 * The editor's Apply used to commit at whatever coordinates the sketch was
 * drawn at, which is almost never where the student wanted it. The sketch is
 * finished, but its POSITION is still the student's to choose - so the editor
 * hands it here, the page shows it following the cursor, and the click is what
 * commits it.
 *
 * THE DATA IS NOT DISCARDED. The finished sketch lives on the session until it
 * is committed or cancelled, so entering placement mode cannot lose the work
 * the student just did. Escape cancels the placement and follows DAETUM's
 * established cancellation - it does not silently drop the sketch.
 *
 * THE PREVIEW IS THE COMMIT. The transform computed here is the transform the
 * commit applies, so the geometry under the cursor is the geometry that lands.
 */

import enggDrawingState from "../../../shared/model/drawing-state.js";
import enggGridPlacement from "../../../shared/placement/grid-placement.js";
import { drawingState, editorState } from "../editor-state.js";
import { renderCurrentDrawing } from "../../../components/layout/workspace/canvas-render.js";
import { setToolMessage } from "../../../components/layout/toolbar/toolbar-render.js";

/* The instruction shown while a sketch is waiting to be placed. */
export const PLACEMENT_INSTRUCTION =
  "Click where the sketch belongs - Escape cancels";

/* ============================================================
 * BEGINNING A PLACEMENT
 * ============================================================
 *
 * `sketch` is the editor's finished result:
 *
 *   strokes      the reconstructed strokes, in the editor's own coordinates
 *   calibration  the graph's origin and tick spacing, or null
 *   commit       called with the placement transform when the student clicks
 *   cancel       called if the placement is abandoned
 */
export function beginPlacement(sketch, options = {}) {
  if (!sketch || !Array.isArray(sketch.strokes) || !sketch.strokes.length) {
    return false;
  }

  editorState.pendingPlacement = {
    strokes: sketch.strokes,
    calibration: sketch.calibration || null,
    commit: options.commit || sketch.commit || null,
    cancel: options.cancel || sketch.cancel || null,
    placement: null,
  };

  setToolMessage(PLACEMENT_INSTRUCTION);

  renderCurrentDrawing();

  return true;
}

/* Whether a sketch is waiting to be placed. */
export function placementPending() {
  return Boolean(editorState.pendingPlacement);
}

/* The pending sketch, or null. */
export function pendingPlacement() {
  return editorState.pendingPlacement || null;
}

/* ============================================================
 * MOVING THE PREVIEW
 * ============================================================
 *
 * Called on every pointer move while a placement is pending. The transform is
 * recomputed from the cursor and the page grid, and published on the
 * interaction so the ordinary preview pass draws it.
 */
export function movePlacement(point) {
  const session = editorState.pendingPlacement;

  if (!session || !point) {
    return false;
  }

  const grid = enggGridPlacement.pageGridOf(drawingState);

  const placement = enggGridPlacement.placeSketch(
    { strokes: session.strokes, calibration: session.calibration },
    point,
    grid,
  );

  if (!placement) {
    return false;
  }

  session.placement = placement;

  enggDrawingState.setInteraction(drawingState, {
    ...drawingState.interaction,
    preview: {
      placement,
      strokes: session.strokes,
      style: { stroke: "#1f5c38" },
    },
  });

  /*
   * THE NOTE IS THE HONEST ANSWER ABOUT ALIGNMENT. When the graph's ticks
   * cannot be matched to the page grid, the student is told so rather than
   * being left to wonder why the graph did not snap.
   */
  setToolMessage(placement.note ? `${PLACEMENT_INSTRUCTION} - ${placement.note}` : PLACEMENT_INSTRUCTION);

  renderCurrentDrawing();

  return true;
}

/* ============================================================
 * COMMITTING
 * ============================================================
 *
 * The click is the placement. The transform the student saw is the transform
 * applied, and the commit callback receives it.
 */
export function commitPlacement(point) {
  const session = editorState.pendingPlacement;

  if (!session) {
    return false;
  }

  if (point) {
    movePlacement(point);
  }

  const placement = session.placement;

  if (!placement) {
    return false;
  }

  editorState.pendingPlacement = null;

  enggDrawingState.setInteraction(drawingState, {
    ...drawingState.interaction,
    preview: null,
  });

  session.commit?.(placement);

  renderCurrentDrawing();

  return true;
}

/* ============================================================
 * CANCELLING
 * ============================================================
 *
 * Escape during a pending placement abandons the placement and follows the
 * established cancellation: the preview goes, the tool returns to Select, and
 * nothing is committed. The sketch itself is not silently kept - the student
 * asked to stop, and stopping means stopping.
 */
export function cancelPlacement() {
  const session = editorState.pendingPlacement;

  if (!session) {
    return false;
  }

  editorState.pendingPlacement = null;

  enggDrawingState.setInteraction(drawingState, {
    ...drawingState.interaction,
    preview: null,
  });

  session.cancel?.();

  renderCurrentDrawing();

  return true;
}

const enggPlacementSession = {
  PLACEMENT_INSTRUCTION,
  beginPlacement,
  placementPending,
  pendingPlacement,
  movePlacement,
  commitPlacement,
  cancelPlacement,
};

export default enggPlacementSession;

/*
 * ============================================================
 * THE SOURCE -> CANVAS BRIDGE
 * ============================================================
 *
 * Puts a compiled drawing onto the canvas.
 *
 * WHAT THIS MODULE USED TO BE, AND WHY IT IS NOW THIS SMALL.
 *
 * It used to place the source's picture in a layer OVER the model's drawing,
 * with the two toggled: the model was shown while editing, the source while
 * reading Source. That made the canvas a HYBRID - whichever of two renderers
 * was visible depended on what the student was doing - and it meant that for
 * most of a session the Drawing Space was not showing the source at all.
 *
 * The Drawing Space now always shows the compiled source. The model draws only
 * the interaction overlay (grid, selection, handles, previews), and the compile
 * itself lives in `canvas-render.js` because it IS the drawing path - not a
 * detail of the Source tab.
 *
 * What remains here is the one entry point the Source tab knows: hand it a
 * compiled SVG and it becomes the picture on the canvas. Nothing else - no
 * second renderer, no toggling, no model-drawn fallback.
 */

import { renderCurrentDrawing } from "../workspace/canvas-render.js";

/*
 * `svg` is the root element the rendering adapter returned. The canvas already
 * cached it by revision before calling this, so a draw is what places it, at
 * the current camera, beneath the interaction overlay.
 */
export function showRenderedSource(svg) {
  if (!svg) {
    return false;
  }

  renderCurrentDrawing();

  return true;
}

/*
 * There is no longer a source layer to hide: the picture IS the drawing, and
 * the model's layer carries only interaction aids. Kept so a caller written
 * against the old two-layer model still runs.
 */
export function hideSourceLayer() {
  return false;
}

export function notifyDrawingChanged() {
  renderCurrentDrawing();
}

export function isSourceLayerActive() {
  return true;
}

export function refreshCanvasFromSource(svg, options = {}) {
  return showRenderedSource(svg, options);
}

export default {
  showRenderedSource,
  hideSourceLayer,
  notifyDrawingChanged,
  isSourceLayerActive,
  refreshCanvasFromSource,
};

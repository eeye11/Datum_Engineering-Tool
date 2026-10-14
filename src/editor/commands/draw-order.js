/*
 * ========================================================
 * DRAW ORDER
 * ========================================================
 *
 * Which feature is drawn ON TOP of which.
 *
 * THE ORDER IS THE ARRAY. The renderer walks `state.objects` in order and
 * appends each feature's SVG as it goes, so a feature later in the array is
 * drawn over one earlier in it. Draw order is therefore not a separate property
 * to keep in step with anything - it is the position in the one list the whole
 * application already uses. That is deliberate: a second `zIndex` field would be
 * a second source of truth for the same fact, and the two would eventually
 * disagree.
 *
 * WHY THIS IS NOT A SELECTION CONCERN
 * -----------------------------------
 * Changing the order changes ONLY what covers what. It must never change what
 * can be picked, snapped to, dimensioned or found by a selection rectangle. The
 * hit test walks the array BACKWARDS (topmost first) so that overlapping
 * features are picked in the order they look, but a feature sent to the back is
 * still hit-tested - just last - and a feature drawn under another is still
 * reachable wherever the one on top is not actually under the cursor. Draw order
 * is a visual statement, not an access-control list.
 *
 * WHY IT IS A DOCUMENT EDIT
 * -------------------------
 * The order is part of the drawing: it is saved, it survives a reopen, and it
 * is something the user chose. So every command here is one committed change -
 * one history entry, one dirty mark, one render - exactly like moving a feature.
 */
import enggDrawingState from "../../core/model/drawing-state.js";
import { drawingState } from "../editor-state.js";
import { renderCurrentDrawing } from "../workspace/canvas-render.js";
import { renderProperties } from "../panels/feature-panel.js";
import { setToolMessage } from "../toolbar/toolbar-render.js";

/*
 * The selected features, in their CURRENT document order.
 *
 * Reading the selection through the document rather than through the selection
 * list keeps the moves well defined: two selected features are always taken in
 * the order they are drawn, so "bring forward" cannot make them swap places with
 * each other by accident.
 */
function selectedInOrder() {
  const selected = new Set(drawingState.selection.selectedObjectIds || []);

  return drawingState.objects.filter((object) => selected.has(object.id));
}

/*
 * Put a reordered list of objects back into the document.
 *
 * ONE committed change for the whole move, so a multi-selection brought to the
 * front is one Undo step and not one per feature.
 */
function commitOrder(nextObjects) {
  const previous = enggDrawingState.snapshotDrawing(drawingState);

  drawingState.objects = nextObjects;

  enggDrawingState.commitDrawingChange(drawingState, previous);

  renderProperties();
  renderCurrentDrawing();
}

/*
 * Bring the selection to the front, keeping the selected features' own relative
 * order. Everything not selected keeps its order too.
 */
function bringToFront() {
  const chosen = selectedInOrder();

  if (!chosen.length) {
    return false;
  }

  const chosenIds = new Set(chosen.map((object) => object.id));

  const rest = drawingState.objects.filter(
    (object) => !chosenIds.has(object.id),
  );

  commitOrder([...rest, ...chosen]);

  setToolMessage(
    chosen.length === 1
      ? `Brought ${chosen[0].name} to the front`
      : `Brought ${chosen.length} features to the front`,
  );

  return true;
}

/*
 * Send the selection to the back.
 */
function sendToBack() {
  const chosen = selectedInOrder();

  if (!chosen.length) {
    return false;
  }

  const chosenIds = new Set(chosen.map((object) => object.id));

  const rest = drawingState.objects.filter(
    (object) => !chosenIds.has(object.id),
  );

  commitOrder([...chosen, ...rest]);

  setToolMessage(
    chosen.length === 1
      ? `Sent ${chosen[0].name} to the back`
      : `Sent ${chosen.length} features to the back`,
  );

  return true;
}

/*
 * Move the selection one place towards the front.
 *
 * Walked from the TOP down, and each selected feature is swapped with the
 * unselected neighbour above it. Going from the top matters: walking upwards
 * would move a selected feature past another selected one that has already
 * moved, which would make a multi-selection drift rather than keep its order.
 */
function bringForward() {
  const chosen = selectedInOrder();

  if (!chosen.length) {
    return false;
  }

  const chosenIds = new Set(chosen.map((object) => object.id));

  const objects = [...drawingState.objects];

  let moved = false;

  for (let index = objects.length - 2; index >= 0; index -= 1) {
    const current = objects[index];
    const above = objects[index + 1];

    if (chosenIds.has(current.id) && !chosenIds.has(above.id)) {
      objects[index] = above;
      objects[index + 1] = current;

      moved = true;
    }
  }

  if (!moved) {
    setToolMessage("Already at the front");

    return false;
  }

  commitOrder(objects);

  setToolMessage("Brought forward");

  return true;
}

/*
 * Move the selection one place towards the back. The mirror of bringForward,
 * walked from the bottom up for the same reason.
 */
function sendBackward() {
  const chosen = selectedInOrder();

  if (!chosen.length) {
    return false;
  }

  const chosenIds = new Set(chosen.map((object) => object.id));

  const objects = [...drawingState.objects];

  let moved = false;

  for (let index = 1; index < objects.length; index += 1) {
    const current = objects[index];
    const below = objects[index - 1];

    if (chosenIds.has(current.id) && !chosenIds.has(below.id)) {
      objects[index] = below;
      objects[index - 1] = current;

      moved = true;
    }
  }

  if (!moved) {
    setToolMessage("Already at the back");

    return false;
  }

  commitOrder(objects);

  setToolMessage("Sent backward");

  return true;
}

const DRAW_ORDER_COMMANDS = {
  front: bringToFront,
  forward: bringForward,
  backward: sendBackward,
  back: sendToBack,
};

/*
 * Run a draw-order command by name. Returns whether anything moved, so a caller
 * can tell "already at the front" from a real reorder.
 */
export function applyDrawOrder(commandId) {
  const command = DRAW_ORDER_COMMANDS[commandId];

  if (!command) {
    return false;
  }

  return command();
}

/*
 * Wire the draw-order buttons to the page.
 *
 * A one-shot command rather than a modal tool: it acts on the current selection
 * and finishes, so it must not go through the global-tool machinery that keeps
 * Pan and Move armed. Selecting a feature first is the whole interaction.
 */
export function installDrawOrderControls() {
  document.querySelectorAll("[data-draw-order]").forEach((button) => {
    button.addEventListener("click", () => {
      applyDrawOrder(button.dataset.drawOrder);
    });
  });
}

export const enggDrawOrder = {
  applyDrawOrder,
  bringForward,
  bringToFront,
  installDrawOrderControls,
  sendBackward,
  sendToBack,
};

export default enggDrawOrder;

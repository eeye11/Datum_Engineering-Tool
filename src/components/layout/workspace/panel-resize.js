/*
 * ============================================================
 * THE SIDEBARS ARE RESIZABLE, AND THE CANVAS TAKES THE DIFFERENCE
 * ============================================================
 *
 * The Tools rail and the Features rail each sit in a grid column of
 * `.drawing-workspace`, and the column between them is `minmax(0, 1fr)` - the
 * only flexible track. So a sidebar's width is not a property of the panel: it
 * is the width of its TRACK, and every pixel given to it is a pixel taken from
 * the drawing.
 *
 * WHY THE SIDEBAR IS RESIZED, NOT THE PANEL.
 *
 * Narrowing the panel inside a fixed track leaves the rest of the track claimed
 * by nothing - the drawing does not grow and the drag appears to do nothing.
 * The track is what the layout sizes, so the track is what is written: the two
 * widths live in custom properties (`--tools-rail-width`,
 * `--features-rail-width`) on the workspace, and the column template is
 * re-derived from them in ONE place, beside the Hide buttons' collapsed state.
 *
 * THE DRAWING IS NOT RE-SCALED.
 *
 * Zoom, pan, the model and the source are all untouched - only the width of the
 * canvas element changes. The viewport is measured from that element on every
 * render (see `canvasBounds`), so a wider canvas shows more of the drawing at
 * the zoom the student chose, exactly as collapsing a panel already did. A
 * redraw is all that is needed, and it is the only thing that happens.
 *
 * THE LIMITS ARE MEASURED, NOT GUESSED.
 *
 * A minimum keeps a panel usable (a tool button's icon and labels; a property
 * row's four tracks). A maximum keeps the drawing worth looking at: neither
 * sidebar may take more than `MAX_SHARE` of the workspace, so two wide panels
 * can never add up to a canvas that is not there. Both are clamped again
 * against the space the canvas needs, so the drag simply stops rather than
 * covering the drawing.
 */

const MIN_WIDTH = 150;
const MAX_WIDTH = 460;
const MIN_CANVAS_WIDTH = 280;
const MAX_SHARE = 0.45;

const DEFAULT_WIDTHS = {
  left: 202,
  right: 236,
};

export const PANEL_RESIZE_LIMITS = Object.freeze({
  MIN_WIDTH,
  MAX_WIDTH,
  MIN_CANVAS_WIDTH,
  MAX_SHARE,
  DEFAULT_WIDTHS,
});

function clamp(value, low, high) {
  return Math.min(high, Math.max(low, value));
}

/*
 * HOW WIDE ONE SIDEBAR MAY BECOME.
 *
 * The viewport is the ceiling and the panel's own minimum is the floor; the
 * share and the canvas's reservation are then both applied so neither a very
 * large window nor a very small one can produce a panel with no drawing beside
 * it. `other` is what the opposite rail is taking, which is why the canvas
 * reservation is about the BOTH of them rather than about this one.
 */
export function panelWidthLimits(workspaceWidth, other = 0) {
  const viewport = Number(workspaceWidth) > 0 ? Number(workspaceWidth) : 0;

  if (!viewport) {
    return { min: MIN_WIDTH, max: MAX_WIDTH };
  }

  const byShare = viewport * MAX_SHARE;
  const byCanvas = viewport - Number(other || 0) - MIN_CANVAS_WIDTH;

  return {
    min: MIN_WIDTH,
    max: Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, byShare, byCanvas)),
  };
}

export function clampPanelWidth(width, workspaceWidth, other = 0) {
  const { min, max } = panelWidthLimits(workspaceWidth, other);

  const value = Number(width);

  if (!Number.isFinite(value)) {
    return null;
  }

  return clamp(value, min, max);
}

/*
 * The workspace's column template, from the two rail widths and their states.
 *
 * ONE function for every combination, so the Hide buttons and the drags cannot
 * produce a template that describes a state neither of them is in. A collapsed
 * rail is its 22px arrow strip - the same width the stylesheet gives it - and
 * the drawing takes everything that is left.
 */
export function workspaceColumns({
  left = DEFAULT_WIDTHS.left,
  right = DEFAULT_WIDTHS.right,
  leftCollapsed = false,
  rightCollapsed = false,
} = {}) {
  const leftTrack = leftCollapsed
    ? 22
    : `${Math.round(Number(left) || DEFAULT_WIDTHS.left)}px`;
  const rightTrack = rightCollapsed
    ? 22
    : `${Math.round(Number(right) || DEFAULT_WIDTHS.right)}px`;

  return `${leftTrack} minmax(0, 1fr) ${rightTrack}`;
}

function railOf(side) {
  return document.getElementById(
    side === "left" ? "drawingToolPanelRail" : "drawingFeaturesPanelRail",
  );
}

function resizerOf(side) {
  return document.getElementById(
    side === "left" ? "drawingToolPanelResizer" : "drawingFeaturesPanelResizer",
  );
}

function store() {
  return document.querySelector(".drawing-workspace");
}

function widthOf(side) {
  const rail = railOf(side);

  if (!rail) {
    return DEFAULT_WIDTHS[side];
  }

  const railWidth = rail.getBoundingClientRect().width;

  if (railWidth > 0) {
    return railWidth;
  }

  return Number(rail.dataset.railWidth) || DEFAULT_WIDTHS[side];
}

/*
 * A DRAG IN PROGRESS.
 *
 * The pointer is captured on the handle, so a drag that leaves the handle - or
 * the window - keeps receiving moves until the button is released, and a
 * `pointercancel` ends it without leaving the layout half-written.
 *
 * THE WIDTH IS MEASURED FROM THE RAIL, not accumulated from the pointer deltas:
 * a drag that is clamped at its limit and then dragged back must return to the
 * size the student is asking for, not to a running total of movement that the
 * clamp absorbed.
 */
function beginDrag(side, event) {
  const workspace = store();
  const rail = railOf(side);

  if (!workspace || !rail || event.button > 0) {
    return;
  }

  event.preventDefault();

  const startX = event.clientX;
  const startWidth = rail.getBoundingClientRect().width;
  const resizer = event.currentTarget;

  resizer.setPointerCapture?.(event.pointerId);
  resizer.classList.add("drawing-panel-resizer-active");
  document.body.classList.add("drawing-panel-resizing");

  const move = (moveEvent) => {
    const delta = moveEvent.clientX - startX;

    /* The left rail grows to the RIGHT; the right rail grows to the LEFT. */
    const asked = side === "left" ? startWidth + delta : startWidth - delta;

    applyWidth(side, asked);
  };

  const end = () => {
    resizer.removeEventListener("pointermove", move);
    resizer.removeEventListener("pointerup", end);
    resizer.removeEventListener("pointercancel", end);

    resizer.classList.remove("drawing-panel-resizer-active");
    document.body.classList.remove("drawing-panel-resizing");

    try {
      resizer.releasePointerCapture?.(event.pointerId);
    } catch {
      /* The pointer may already have been released by the browser. */
    }
  };

  resizer.addEventListener("pointermove", move);
  resizer.addEventListener("pointerup", end);
  resizer.addEventListener("pointercancel", end);
}

/*
 * ONE WIDTH, WRITTEN AND DRAWN.
 *
 * The clamp is against the CURRENT workspace, so a panel cannot be dragged past
 * the canvas's own reservation - the drag stops at the wall rather than covering
 * the drawing. Nothing else is touched: the camera, the objects and the source
 * are exactly as they were, and the redraw only re-measures the canvas.
 */
export function applyWidth(side, asked, { redraw = true } = {}) {
  const workspace = store();

  if (!workspace) {
    return null;
  }

  const other = side === "left" ? "right" : "left";
  const otherWidth = railOf(other)?.classList.contains(
    "drawing-panel-rail-collapsed",
  )
    ? 22
    : widthOf(other);

  const width = clampPanelWidth(
    asked,
    workspace.getBoundingClientRect().width,
    otherWidth,
  );

  if (width === null) {
    return null;
  }

  const rail = railOf(side);

  if (rail) {
    rail.dataset.railWidth = String(Math.round(width));
  }

  workspace.dataset[side === "left" ? "toolsRailWidth" : "featuresRailWidth"] =
    String(Math.round(width));

  syncWorkspaceColumns();

  if (redraw) {
    notifyResized();
  }

  return width;
}

/*
 * THE LAYOUT IS RE-DERIVED FROM THE STATE, ONCE.
 *
 * `syncWorkspaceColumns` owns the template - this module states the widths and
 * the caller's redraw follows. Imported lazily rather than at module load so
 * this module does not take part in a cycle with the layout it adjusts.
 */
let syncColumns = null;

export function installColumnSync(fn) {
  syncColumns = typeof fn === "function" ? fn : null;
}

function syncWorkspaceColumns() {
  syncColumns?.();
}

let redraw = null;

export function installPanelResizeRedraw(fn) {
  redraw = typeof fn === "function" ? fn : null;
}

function notifyResized() {
  redraw?.();
}

/* The two widths currently in force, for a caller that has to restore them. */
export function currentRailWidths() {
  return {
    left: widthOf("left"),
    right: widthOf("right"),
  };
}

/*
 * A RESIZER IS ALSO A KEYBOARD CONTROL.
 *
 * `role="separator"` with `aria-orientation="vertical"` is the standard shape
 * for a vertical splitter, and the arrow keys are what it is expected to
 * answer: a pointer-only resize is unreachable without a mouse. The step is the
 * arrow key's own movement, so a keyboard resize is the same gesture.
 */
const KEY_STEP = 16;

function onKeyDown(side, event) {
  const rail = railOf(side);

  if (!rail) {
    return;
  }

  const width = rail.getBoundingClientRect().width;

  const wants =
    event.key === "ArrowLeft"
      ? side === "left"
        ? width - KEY_STEP
        : width + KEY_STEP
      : event.key === "ArrowRight"
        ? side === "left"
          ? width + KEY_STEP
          : width - KEY_STEP
        : event.key === "Home"
          ? PANEL_RESIZE_LIMITS.MIN_WIDTH
          : event.key === "End"
            ? PANEL_RESIZE_LIMITS.MAX_WIDTH
            : null;

  if (wants === null) {
    return;
  }

  event.preventDefault();

  const applied = applyWidth(side, wants);

  const resizer = event.currentTarget;

  if (applied !== null) {
    resizer.setAttribute("aria-valuenow", String(Math.round(applied)));
    resizer.setAttribute(
      "aria-valuemin",
      String(PANEL_RESIZE_LIMITS.MIN_WIDTH),
    );
    resizer.setAttribute(
      "aria-valuemax",
      String(PANEL_RESIZE_LIMITS.MAX_WIDTH),
    );
  }
}

export function installPanelResize() {
  ["left", "right"].forEach((side) => {
    const resizer = resizerOf(side);

    if (!resizer || resizer.dataset.resizeWired === "true") {
      return;
    }

    resizer.dataset.resizeWired = "true";

    resizer.addEventListener("pointerdown", (event) => beginDrag(side, event));
    resizer.addEventListener("keydown", (event) => onKeyDown(side, event));
  });

  /*
   * A WINDOW THAT SHRINKS PAST A PANEL'S LIMIT TAKES THE PANEL WITH IT. Without
   * this a sidebar dragged wide in a maximised window covers most of the
   * drawing once the window is made small - the limit is a live constraint, not
   * a one-off check at the moment of the drag.
   */
  globalThis.addEventListener?.(
    "resize",
    () => {
      applyWidth("left", widthOf("left"), { redraw: false });
      applyWidth("right", widthOf("right"), { redraw: false });
    },
    { passive: true },
  );
}

export default {
  PANEL_RESIZE_LIMITS,
  panelWidthLimits,
  clampPanelWidth,
  workspaceColumns,
  applyWidth,
  currentRailWidths,
  installColumnSync,
  installPanelResizeRedraw,
  installPanelResize,
};

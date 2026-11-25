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

/*
 * THE WIDTHS ARE REMEMBERED BETWEEN SESSIONS.
 *
 * They are an interface preference of the student's, not a property of the
 * drawing, so they live beside the other `datum:` preferences in localStorage
 * rather than in the saved document - reopening a file must not carry one
 * student's sidebar widths onto another's screen.
 *
 * ONE KEY FOR BOTH SIDES, because the pair is what has to fit in a window: two
 * separate keys could be written by two tabs and leave one stale. It is read
 * and validated on every load, and a value that no longer fits the viewport is
 * clamped rather than discarded, so a student who resizes a window down and back
 * up keeps the width they chose.
 */
const WIDTHS_STORAGE_KEY = "datum:sidebar-widths";

function readStoredWidths() {
  try {
    const raw = globalThis.localStorage?.getItem(WIDTHS_STORAGE_KEY);

    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw);
    const left = Number(parsed?.left);
    const right = Number(parsed?.right);

    return {
      left: Number.isFinite(left) && left > 0 ? left : null,
      right: Number.isFinite(right) && right > 0 ? right : null,
    };
  } catch (error) {
    /* Unreadable or blocked storage means the defaults, not a broken layout. */
    return null;
  }
}

function writeStoredWidths(left, right) {
  try {
    globalThis.localStorage?.setItem(
      WIDTHS_STORAGE_KEY,
      JSON.stringify({ left: Math.round(left), right: Math.round(right) }),
    );
  } catch (error) {
    /* A preference that cannot be stored is simply not remembered. */
  }
}

/*
 * The widths to open with: the stored pair validated against this window, or
 * the defaults when there is nothing stored. Each side is clamped against the
 * OPPOSITE side's stored width, so a pair saved in a wide window opens as the
 * widest pair that still leaves the drawing usable in a narrow one.
 */
export function initialRailWidths(workspaceWidth) {
  const stored = readStoredWidths();
  const viewport = Number(workspaceWidth) > 0 ? Number(workspaceWidth) : 0;

  const left = stored?.left ?? DEFAULT_WIDTHS.left;
  const right = stored?.right ?? DEFAULT_WIDTHS.right;

  return {
    left: clampPanelWidth(left, viewport, right) ?? DEFAULT_WIDTHS.left,
    right: clampPanelWidth(right, viewport, left) ?? DEFAULT_WIDTHS.right,
  };
}

export const PANEL_RESIZE_LIMITS = Object.freeze({
  MIN_WIDTH,
  MAX_WIDTH,
  MIN_CANVAS_WIDTH,
  MAX_SHARE,
  DEFAULT_WIDTHS,
  /*
   * A DRAG PAST THIS WIDTH HIDES THE PANEL, exactly as the Hide button does.
   * It is comfortably below the narrowest panel that is still usable (a tool
   * icon column and a property row), so a student can leave a panel very narrow
   * deliberately, and past it the next few pixels of travel mean "gone" rather
   * than a sliver too thin to use. Any drag that reaches the strip has crossed
   * it, so "drag it shut" and "press Hide" always end in the same state.
   */
  COLLAPSE_BELOW: 100,
});

/*
 * The collapsed strip's own width, and the width a rail is given in the column
 * template while collapsed: the 22px arrow strip. The resize handle rides ON
 * TOP of the strip (see `.drawing-panel-rail-collapsed` in side-panels.css), so
 * it does not widen the track - a collapsed rail is exactly the width the Hide
 * button's own state always was, and the canvas takes the whole panel's space.
 */
const COLLAPSED_RAIL_WIDTH = 22;

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
    return { min: 0, max: MAX_WIDTH };
  }

  const byShare = viewport * MAX_SHARE;
  const byCanvas = viewport - Number(other || 0) - MIN_CANVAS_WIDTH;

  return {
    min: 0,
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
  /*
   * EVERY TRACK CARRIES ITS UNIT. A bare `22` is not a grid track - the browser
   * discards the whole `grid-template-columns` declaration, and the stylesheet's
   * own template takes over. That is what made pressing Hide look like it did
   * nothing to the canvas: the rail collapsed, the template was invalid, and the
   * column kept the panel's full width.
   */
  const leftTrack = leftCollapsed
    ? `${COLLAPSED_RAIL_WIDTH}px`
    : `${Math.round(Number(left) || DEFAULT_WIDTHS.left)}px`;
  const rightTrack = rightCollapsed
    ? `${COLLAPSED_RAIL_WIDTH}px`
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
    return lastExpandedWidths[side] ?? DEFAULT_WIDTHS[side];
  }

  /*
   * A COLLAPSED RAIL ANSWERS WITH THE WIDTH IT WILL COME BACK AT. Its box is
   * 22px while collapsed, so measuring it would report the arrow strip and a
   * Hide/Show round trip would silently shrink the panel to it.
   */
  if (rail.classList.contains("drawing-panel-rail-collapsed")) {
    return lastExpandedWidths[side] ?? DEFAULT_WIDTHS[side];
  }

  const railWidth = rail.getBoundingClientRect().width;

  if (railWidth > 0) {
    return railWidth;
  }

  return (
    Number(rail.dataset.railWidth) ||
    lastExpandedWidths[side] ||
    DEFAULT_WIDTHS[side]
  );
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

  const wasCollapsed = rail.classList.contains("drawing-panel-rail-collapsed");

  /*
   * THE POINTER'S STARTING X, and the width the panel will be measured against.
   *
   * A DRAG OUT OF THE HIDDEN STRIP IS MEASURED FROM THE REMEMBERED WIDTH, not
   * from the 22px strip: the panel is reopened at the size the student left it
   * and the rest of the drag adjusts that. Measuring from the strip made a
   * normal pull ask for far too small a width and fall straight back under the
   * collapse threshold - "pulling the hidden panel open does nothing".
   */
  const startX = event.clientX;
  const startWidth = wasCollapsed ? lastExpandedWidth(side) : widthOf(side);

  /*
   * THE WIDTH THE PANEL HAS ON SCREEN NOW, BEFORE ANY OF THIS DRAG TOUCHES IT.
   *
   * A collapse must remember THIS, not whatever a later move happened to write,
   * or dragging a panel away would replace its remembered width with the last
   * narrow-but-open width it passed through and Show would reopen it there.
   */
  const widthBeforeDrag = wasCollapsed ? null : rail.getBoundingClientRect().width;

  const resizer = event.currentTarget;

  /*
   * THE FIRST EXPANSION IS THE PANEL'S, NOT A SECOND COLLAPSE STATE. Dragging out
   * of the hidden strip goes through the same `setPanelCollapsed` the arrow does,
   * so the panel, the toggle's caption and the arrow all come back.
   */
  if (wasCollapsed) {
    applyCollapsed(side, false);
  }

  resizer.setPointerCapture?.(event.pointerId);
  resizer.classList.add("drawing-panel-resizer-active");
  document.body.classList.add("drawing-panel-resizing");

  /*
   * A DRAG COLLAPSES AT MOST ONCE PER DIRECTION. Below the threshold the panel
   * takes the Hide button's state; coming back above it, it reopens at the width
   * the pointer is asking for - measured from the width it had when the drag
   * began, so the panel follows the pointer without a jump.
   */
  const move = (moveEvent) => {
    const delta = moveEvent.clientX - startX;

    /* The left rail grows to the RIGHT; the right rail grows to the LEFT. */
    const asked = side === "left" ? startWidth + delta : startWidth - delta;

    if (asked < PANEL_RESIZE_LIMITS.COLLAPSE_BELOW) {
      /*
       * ALREADY HIDDEN: nothing to re-apply on every further move. The first
       * move that crosses the threshold collapses the panel FROM THE WIDTH IT
       * HAD BEFORE THE DRAG, so the remembered width is the one being left
       * behind rather than the edge case the drag clipped at.
       */
      if (!rail.classList.contains("drawing-panel-rail-collapsed")) {
        if (widthBeforeDrag !== null) {
          lastExpandedWidths[side] = widthBeforeDrag;
        }

        applyCollapsed(side, true);

        /*
         * THE TEMPLATE IS RE-DERIVED AFTER THE COLLAPSE, NOT BEFORE. The last
         * open move already wrote a template with the panel's mid-drag width in
         * it; hiding the rail does not rewrite the grid by itself, so without
         * this sync the canvas keeps the room of a panel that is no longer there.
         */
        syncWorkspaceColumns();
        notifyResized();
      }

      return;
    }

    /*
     * COMING BACK ABOVE THE THRESHOLD REOPENS IT, at the width the pointer asks
     * for - measured from the width the drag began at, so the panel follows the
     * pointer with no jump.
     */
    if (rail.classList.contains("drawing-panel-rail-collapsed")) {
      applyCollapsed(side, false);
    }

    applyWidth(side, asked, { remember: false });
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

    /*
     * THE SIZE THE DRAG ENDED AT IS THE ONE TO REMEMBER, committed once here.
     * A drag that ended hidden changed nothing - the width it left behind is the
     * one already stored - and a drag that ended open stores the width the panel
     * is now at, not the size it had before the gesture.
     *
     * THE CLAMPED WIDTH IS STORED, NOT THE NUMBER THE POINTER ASKED FOR. A drag
     * that runs past the maximum asks for more than the panel was allowed to
     * take, and remembering that number would reopen the panel wider than the
     * same window could show - so the measurement is taken from the rail as it
     * finally stands, which is the width on screen.
     */
    if (!rail.classList.contains("drawing-panel-rail-collapsed")) {
      const settled = Math.round(rail.getBoundingClientRect().width);

      if (settled > 0) {
        lastExpandedWidths[side] = settled;
      }
    }

    /*
     * WHAT IS STORED IS THE EXPANDED WIDTH, never the collapsed one: a panel
     * dragged shut and reopened must come back at the size it had, not at the
     * 22px strip it was dragged through.
     */
    writeStoredWidths(lastExpandedWidths.left, lastExpandedWidths.right);
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
export function applyWidth(side, asked, { redraw = true, remember = true } = {}) {
  const workspace = store();

  if (!workspace) {
    return null;
  }

  const rail = railOf(side);
  const other = side === "left" ? "right" : "left";

  const otherWidth = () =>
    railOf(other)?.classList.contains("drawing-panel-rail-collapsed")
      ? COLLAPSED_RAIL_WIDTH
      : widthOf(other);

  const value = Number(asked);

  if (!Number.isFinite(value)) {
    return null;
  }

  /*
   * DRAGGED AWAY ENTIRELY IS THE HIDE BUTTON'S OWN STATE, NOT A THIRD ONE.
   *
   * Below the collapse threshold the panel is not merely narrow - it is
   * hidden, through the SAME `setPanelCollapsed` the button calls, so the
   * resulting DOM, the reclaimed track, the arrow and the Show control are
   * identical whichever gesture got there. A separate "width zero" state
   * would look the same and behave differently: the panel would still be in
   * the flow, the Show button would still say HIDE, and the redraw would
   * disagree with the button about what is on screen.
   */
  if (value < PANEL_RESIZE_LIMITS.COLLAPSE_BELOW) {
    applyCollapsed(side, true);

    /*
     * `setPanelCollapsed` renders the drawing itself, so nothing more is asked
     * for here - and calling the deferred redraw as well would run it twice.
     */
    if (!redraw) {
      notifyResized();
    }

    return 0;
  }

  /*
   * A WIDTH THE STUDENT CHOSE IS REMEMBERED AS THE EXPANDED WIDTH, and it is
   * the one the Show button and a drag back out restore. It is taken BEFORE any
   * clamp, so a drag pinned at the wall in a small window still remembers the
   * size that was asked for.
   */
  if (remember) {
    lastExpandedWidths[side] = value;
  }

  /* A RAIL BEING WIDENED IS SHOWN FIRST, through the same path the button uses. */
  if (rail?.classList.contains("drawing-panel-rail-collapsed")) {
    applyCollapsed(side, false);
  }

  const width = clampPanelWidth(
    value,
    workspace.getBoundingClientRect().width,
    otherWidth(),
  );

  if (width === null) {
    return null;
  }

  if (rail) {
    rail.dataset.railWidth = String(Math.round(width));
  }

  syncWorkspaceColumns();

  /*
   * THE REDRAW WAITS FOR THE LAYOUT IT IS MEASURING.
   *
   * `syncWorkspaceColumns` writes the grid template, and the canvas is measured
   * from its own element - but a template written this frame is not laid out
   * until the browser's next one, so a redraw NOW reads the OLD track and the
   * drawing keeps the previous width until something else forces a render. The
   * redraw is therefore deferred one frame, which is the frame the new widths
   * take effect in.
   */
  deferRedraw();

  return width;
}

let redrawFrame = 0;

/*
 * ONE REDRAW PER FRAME, after layout. Several moves in a drag each ask for a
 * redraw; only the last one before the frame is worth doing.
 */
function deferRedraw() {
  const request =
    globalThis.requestAnimationFrame ||
    ((fn) => setTimeout(fn, 0));

  if (redrawFrame) {
    return;
  }

  redrawFrame = request(() => {
    redrawFrame = 0;

    notifyResized();
  });
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

/*
 * THE HIDE BUTTON'S OWN COLLAPSE, HANDED IN BY THE LAYOUT.
 *
 * Dragging a panel away has to reach exactly the state the button reaches, so
 * this module asks the layout to do it rather than staging a second collapse of
 * its own. `installColumnSync` is called from the same place, by the module that
 * owns `setPanelCollapsed`.
 */
let collapse = null;

export function installPanelCollapse(fn) {
  collapse = typeof fn === "function" ? fn : null;
}

function applyCollapsed(side, collapsed) {
  collapse?.(side, collapsed);
}

/*
 * THE WIDTH EACH PANEL GOES BACK TO, per side - the size it had before it was
 * hidden, NOT its 22px strip and not zero. Filled from the drags and from the
 * stored pair, so the Show button, the keyboard and a drag open all restore the
 * same width.
 */
const lastExpandedWidths = { ...DEFAULT_WIDTHS };

export function lastExpandedWidth(side) {
  return lastExpandedWidths[side] ?? DEFAULT_WIDTHS[side];
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

  /*
   * THE KEYBOARD MEASURES THE PANEL, NOT THE RAIL. While a rail is collapsed its
   * box is the 22px strip, so stepping from that would take several presses to
   * get back to a usable panel; `widthOf` answers with the width it will come
   * back at.
   */
  const width = widthOf(side);

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
          ? 0
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
      String(0),
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
   * A SAVED PAIR IS PUT BACK BEFORE THE FIRST DRAG. The rails are started at
   * their stylesheet widths, so the remembered widths are written onto them and
   * the column template re-derived - the same path a drag takes, which is why
   * the restore cannot produce a layout a drag could not.
   */
  const workspace = store();
  const stored = initialRailWidths(
    workspace?.getBoundingClientRect().width ?? 0,
  );

  /*
   * THE REMEMBERED PAIR IS WHAT HIDE/SHOW AND A DRAG BACK OUT RESTORE FROM, so
   * it is recorded before anything is drawn - a panel hidden on the very first
   * press must still know the width it had.
   */
  lastExpandedWidths.left = stored.left;
  lastExpandedWidths.right = stored.right;

  ["left", "right"].forEach((side) => {
    applyWidth(side, stored[side], { redraw: false, remember: false });
  });

  /*
   * A WINDOW THAT SHRINKS PAST A PANEL'S LIMIT TAKES THE PANEL WITH IT. Without
   * this a sidebar dragged wide in a maximised window covers most of the
   * drawing once the window is made small - the limit is a live constraint, not
   * a one-off check at the moment of the drag.
   *
   * THE STORED WIDTHS ARE NOT OVERWRITTEN HERE. A narrow window clamps what is
   * DRAWN, but the student's preference is kept as it was, so widening the
   * window again restores the width they chose rather than leaving them with the
   * smallest one the window ever forced.
   */
  globalThis.addEventListener?.(
    "resize",
    () => {
      /*
       * THE REMEMBERED WIDTH, NOT THE MEASURED ONE: `widthOf` answers with the
       * expanded width for a collapsed rail, and re-applying a width the window
       * no longer allows must clamp it, never hide the panel the student has
       * open. So each side is clamped directly here rather than through
       * `applyWidth`, whose collapse threshold is a drag gesture.
       */
      reapplyWithinViewport();
    },
    { passive: true },
  );
}

function reapplyWithinViewport() {
  const workspace = store();

  if (!workspace) {
    return;
  }

  const viewport = workspace.getBoundingClientRect().width;

  ["left", "right"].forEach((side) => {
    const rail = railOf(side);

    /* A hidden rail is the student's choice and stays hidden. */
    if (rail?.classList.contains("drawing-panel-rail-collapsed")) {
      return;
    }

    const other = side === "left" ? "right" : "left";
    const otherWidth = railOf(other)?.classList.contains(
      "drawing-panel-rail-collapsed",
    )
      ? COLLAPSED_RAIL_WIDTH
      : widthOf(other);

    const width = clampPanelWidth(
      lastExpandedWidths[side],
      viewport,
      otherWidth,
    );

    if (width !== null && rail) {
      rail.dataset.railWidth = String(Math.round(width));
    }
  });

  syncWorkspaceColumns();
}

export default {
  PANEL_RESIZE_LIMITS,
  panelWidthLimits,
  clampPanelWidth,
  workspaceColumns,
  applyWidth,
  currentRailWidths,
  installColumnSync,
  installPanelCollapse,
  installPanelResizeRedraw,
  installPanelResize,
};

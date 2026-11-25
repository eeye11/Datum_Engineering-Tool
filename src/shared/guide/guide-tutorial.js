/*
 * ============================================================
 * THE ACTIVE TUTORIAL
 * ============================================================
 *
 * A tutorial is its own view over the drawing: a compact header, one
 * instruction, and a one-time visual guide that points at the real control the
 * student must use. The student performs the action; the tutorial validates it
 * and moves on by itself.
 *
 * THE FOUR PARTS
 * --------------
 *
 *   header     the tutorial's name, "Step 2 of 6", a progress bar, the device
 *              dropdown and Cancel - and nothing else
 *   panel      one step: its title, its instruction for the chosen device, a
 *              short "your turn" line, and any correction
 *   guide      a pointer that travels ONCE to the target and then stops,
 *              leaving the target outlined
 *   spotlight  the surrounding workspace dimmed, with the target left at full
 *              brightness
 *
 * THERE IS NO NEXT BUTTON BETWEEN STEPS. A step is left when its action is
 * done, and only then. The single exception is the last step, which offers
 * Done after its action succeeds - so the student decides when to leave.
 *
 * THE POINTER GUIDES; IT NEVER ACTS.
 * --------------------------------
 * It cannot click, tap, drag, arm a tool, create an object or change a
 * property. Every part of this overlay is `pointer-events: none` except the
 * header and the panel, so the real control underneath is what the student
 * presses - and the demonstration is a moving mark, not an automation.
 *
 * WHY THE GUIDANCE HAPPENS ONCE
 * -----------------------------
 * A loop that repeats forever competes with the instruction and turns a lesson
 * into a distraction. One pass draws the eye to the target; the outline that
 * stays behind says "here it is" for as long as the step lasts.
 *
 * IT IS MEASURED, NOT GUESSED
 * ---------------------------
 * A target is a real element in the running application, found by the same ids
 * the toolbar and the menu bar already use, and measured with
 * `getBoundingClientRect`. Nothing is placed at a fixed coordinate, so the
 * highlight is right at any window size, panel width and zoom.
 */

import {
  deviceSelectHtml,
  currentMode,
  onModeChange,
  optionFor,
} from "./guide-device.js";
import { instructionFor, taskFor, gestureLabel } from "./guide-wording.js";
import { demoFor } from "./guide-demo.js";

/*
 * How long the pointer's arrival emphasis lasts, once. It is shorter than the
 * pulse the sheet plays so the two read as one gesture rather than two effects.
 */
const POINTER_TRAVEL_MS = 420;

/*
 * How often the action is checked. Polling is deliberate: the checks read the
 * model, and the model has no single "something changed" event that covers an
 * armed tool, a property edit and a new object alike. A short interval against
 * in-memory state is cheaper and far less fragile than subscribing to five
 * subsystems, and it stops dead when the tutorial does.
 */
const ACTION_POLL_MS = 220;

/* How long a completed step is shown before the next one appears. */
const ADVANCE_DELAY_MS = 420;

/*
 * How long the canvas demonstration takes, and the pause before it begins.
 *
 * Short and once. A demonstration that keeps sweeping across the sheet competes
 * with the instruction and with whatever the student is trying to draw - so the
 * mark acts it out one time and then leaves the endpoints behind.
 */
const DEMO_TRAVEL_MS = 720;

/*
 * ============================================================
 * WHERE A DEMONSTRATION HAPPENS - IN DRAWING COORDINATES
 * ============================================================
 *
 * A canvas step is not a control on a toolbar: it is a piece of WORK at a place
 * on the sheet, and the guide has to show WHERE and HOW BIG before the student
 * can repeat it. That place is stored on the step as drawing coordinates (see
 * `guide-demo.js`), and is turned into screen pixels here through the SAME
 * camera the canvas itself uses:
 *
 *     screen.x = width / 2 + (x - panX) * k
 *     screen.y = height / 2 - (y - panY) * k
 *     k = BASE_PIXELS_PER_UNIT * zoom
 *
 * Nothing is hard-coded: the rect is measured after every layout change, so a
 * resize, a zoom or a pan moves the demonstrated path with the sheet instead of
 * leaving it pointing at pixels that no longer mean anything.
 */

/* The camera's own dimensions, read from the element that draws it. */
function canvasFrame() {
  const canvas = document.querySelector(".drawing-canvas");

  if (!canvas) {
    return null;
  }

  const rect = canvas.getBoundingClientRect();

  if (!rect.width || !rect.height) {
    return null;
  }

  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
}

/* The live camera and the pixels-per-drawing-unit ratio. */
async function cameraOf() {
  try {
    const [model, editor] = await Promise.all([
      import("../model/drawing-state.js"),
      import("../../features/workspace/editor-state.js"),
    ]);

    const engine = model.enggDrawingState || model.default;

    const drawing = editor.drawingState;

    if (!drawing?.camera) {
      return null;
    }

    const perUnit = engine.BASE_PIXELS_PER_UNIT || 3.6;

    return {
      zoom: drawing.camera.zoom || 1,
      panX: drawing.camera.panX || 0,
      panY: drawing.camera.panY || 0,
      perUnit,
      grid: drawing.grid || {},
    };
  } catch (error) {
    return null;
  }
}

/*
 * THE VIEW `guide-demo.js` BUILDS A DEMONSTRATION FROM.
 *
 * The centre of the canvas in DRAWING coordinates, and how many drawing units
 * it spans - both from the camera, so the demonstration is sized in the units
 * the student is actually drawing in. The grid spacing is the one the sheet
 * snaps to, so the demonstrated points land on the same lattice a real drag
 * would.
 */
function demoView(frame, camera) {
  const scale = camera.perUnit * camera.zoom;

  const width = frame.width / scale;
  const height = frame.height / scale;

  const spacing = camera.grid?.snapToGrid === false ? 0 : camera.grid?.spacing;

  return {
    centre: { x: camera.panX, y: camera.panY },
    units: { width, height },
    spacing: Number.isFinite(Number(spacing)) && Number(spacing) > 0 ? Number(spacing) : 0,
  };
}

/* A drawing point, in viewport pixels. */
function toScreen(point, frame, camera) {
  const scale = camera.perUnit * camera.zoom;

  return {
    x: frame.left + frame.width / 2 + (point.x - camera.panX) * scale,
    y: frame.top + frame.height / 2 - (point.y - camera.panY) * scale,
  };
}

/*
 * ============================================================
 * FINDING A TARGET
 * ============================================================
 *
 * One function per target kind, returning an element or null. Kept small and
 * explicit: a selector invented per call site is a selector nobody can search
 * for when the markup changes.
 */
function findTarget(target) {
  if (!target || !target.kind) {
    return null;
  }

  switch (target.kind) {
    case "menu":
      return document.querySelector(
        `.datum-menu-label[data-menu-id="${cssEscape(target.id)}"]`,
      );

    case "category":
      return document.querySelector(
        `.drawing-category[data-category="${cssEscape(target.id)}"]`,
      );

    case "tool":
      return document.querySelector(
        `.drawing-tool[data-tool-id="${cssEscape(target.id)}"]`,
      );

    case "control":
      return document.getElementById(target.id);

    case "canvas":
      return (
        document.querySelector(".drawing-canvas") ||
        document.querySelector(".drawing-canvas-area")
      );

    case "guide":
      return document.querySelector("[data-guide-body]");

    default:
      return null;
  }
}

function cssEscape(value) {
  if (globalThis.CSS && typeof globalThis.CSS.escape === "function") {
    return globalThis.CSS.escape(String(value));
  }

  return String(value).replace(/["\\]/g, "\\$&");
}

/*
 * THE CONTROL THAT STANDS FOR A TARGET THAT IS NOT ON SCREEN.
 *
 * Some steps point at an element that only exists when something is open: a
 * tool button inside a collapsed group, a Features row before anything is
 * selected, a menu command that is not drawn. Highlighting "the canvas" for
 * those is wrong - the drawing area lies UNDER the menu bar, so the ring lands
 * on the menu row and a step about a tool appears to point at Help.
 *
 * So each kind of target has a CONTAINER that genuinely holds it, and that is
 * what is outlined when the exact control cannot be found. The instruction
 * still says what to do; the ring says where to look for it.
 */
function fallbackTarget(target) {
  switch (target?.kind) {
    case "tool":
      /* A tool lives in the Tools panel - outline the panel. */
      return (
        document.getElementById("drawingToolList") ||
        document.getElementById("drawingToolPanel")
      );

    case "category":
      /* The toolset strip, which holds every category button. */
      return (
        document.querySelector(".drawing-toolbar-scroll") ||
        document.querySelector(".drawing-toolbar")
      );

    case "menu":
      /*
       * A MENU COMMAND THAT IS NOT DRAWN. The menu's own bar is the container,
       * but ringing the whole bar would include the other five labels - so the
       * LABEL the command lives under is preferred, and the bar is only the
       * last resort for a menu that is not in the bar at all.
       */
      return (
        document.querySelector(
          `.datum-menu-label[data-menu-id="${cssEscape(target.id)}"]`,
        ) || document.getElementById("datumMenuBar")
      );

    case "control":
      /* A control that is hidden is most often inside a closed panel tab. */
      return (
        document.getElementById("drawingFeaturesPanel") ||
        document.getElementById("drawingPanelFeatures")
      );

    default:
      return document.querySelector(".drawing-canvas");
  }
}

/*
 * A target's rectangle, in viewport coordinates.
 *
 * A hidden element measures as a zero box, which would put the ring in the
 * corner of the screen, so an element that is not laid out is treated as
 * missing and the caller falls back.
 */
function rectOf(element) {
  if (!element || typeof element.getBoundingClientRect !== "function") {
    return null;
  }

  const rect = element.getBoundingClientRect();

  if (!rect || (rect.width === 0 && rect.height === 0)) {
    return null;
  }

  if (rect.bottom < 0 || rect.top > window.innerHeight) {
    return null;
  }

  return rect;
}

/* The pad a ring would use if nothing were in its way. */
const DEFAULT_PAD = 6;

/*
 * GROW A RECTANGLE - BUT NEVER ONTO ITS NEIGHBOURS.
 *
 * The pad is what makes the ring read as sitting AROUND the control rather than
 * on it, so a few pixels are wanted. The menu bar and the toolset strip are
 * tightly packed, though: a 6px pad around one label reaches into the next one,
 * and a step about "the menu bar" appeared to be pointing at Tools.
 *
 * So the padding shrinks to fit the gap that is actually there. The ring still
 * hugs the control it names, and it cannot be read as naming the one beside it.
 */
function inflate(rect, by = DEFAULT_PAD) {
  const pad = Math.max(1, Math.min(by, roomAround(rect)));

  return {
    left: rect.left - pad,
    top: rect.top - pad,
    width: rect.width + pad * 2,
    height: rect.height + pad * 2,
    right: rect.right + pad,
    bottom: rect.bottom + pad,
  };
}

/*
 * THE CLEARANCE AROUND A RECT, as half the smallest gap to a sibling control.
 *
 * Half, because the pad grows on ONE side and the neighbour's own edge is
 * on the other - a pad equal to the whole gap would meet it exactly, and a
 * pixel of rounding would overlap it.
 */
function roomAround(rect) {
  const siblings = document.querySelectorAll(
    ".datum-menu-label, .drawing-category, .drawing-tool, .datum-menu-item",
  );

  let room = Infinity;

  siblings.forEach((sibling) => {
    const other = sibling.getBoundingClientRect();

    if (!other.width || !other.height) {
      return;
    }

    /* Itself, and anything containing or contained by it, is not a neighbour. */
    if (
      (other.left <= rect.left && other.right >= rect.right &&
        other.top <= rect.top && other.bottom >= rect.bottom) ||
      (rect.left <= other.left && rect.right >= other.right &&
        rect.top <= other.top && rect.bottom >= other.bottom)
    ) {
      return;
    }

    /* The gap on each axis; only an overlap on the OTHER axis makes it a
       neighbour worth respecting. */
    const overlapsVertically = other.top < rect.bottom && other.bottom > rect.top;
    const overlapsHorizontally = other.left < rect.right && other.right > rect.left;

    if (overlapsVertically) {
      room = Math.min(room, Math.abs(other.left - rect.right), Math.abs(rect.left - other.right));
    }

    if (overlapsHorizontally) {
      room = Math.min(room, Math.abs(other.top - rect.bottom), Math.abs(rect.top - other.bottom));
    }
  });

  return Number.isFinite(room) ? Math.floor(room / 2) : DEFAULT_PAD;
}

/*
 * ============================================================
 * THE OVERLAY'S PIECES
 * ============================================================
 */
let overlay = null;
let scrim = null;
let ring = null;
let header = null;
let panel = null;
let pointer = null;
let liveRegion = null;

let tutorial = null;
let stepIndex = 0;
let currentStep = null;
let handlers = {};

/*
 * THE STATE OF THE STEP BEING SHOWN.
 *
 *   "pending"  the action is outstanding
 *   "done"     the student performed it, and the step is leaving
 *
 * `advancing` is the guard that makes one action advance ONE step. A poll can
 * fire twice before a re-render, and a completed step must not be processed
 * twice - so the flag is set before anything asynchronous happens and is only
 * cleared when the next step has been rendered.
 */
let stepState = { status: "pending", baseline: null, feedback: null };
let advancing = false;

let actionTimer = null;
let advanceTimer = null;

let resizeObserver = null;
let unsubscribeMode = null;

/*
 * THE RECTANGLE LAST DRAWN, so a layout notification that changes nothing can
 * be ignored - see `onLayoutChange`. It is cleared whenever a step is rendered,
 * because a new step always needs its own first measurement.
 */
let lastHole = null;

function sameHole(a, b) {
  return Boolean(
    a &&
      b &&
      Math.round(a.left) === Math.round(b.left) &&
      Math.round(a.top) === Math.round(b.top) &&
      Math.round(a.width) === Math.round(b.width) &&
      Math.round(a.height) === Math.round(b.height),
  );
}

/* The canvas demonstration: its own layer, its own timers, its own geometry. */
let demoLayer = null;
let demoStart = null;
let demoEnd = null;
let demoTimers = [];
let demoRun = 0;

function totalSteps() {
  return tutorial?.steps?.length || 0;
}

function isFinalStep() {
  return stepIndex === totalSteps() - 1;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/* The current device mode, read through one function so it cannot drift. */
function mode() {
  return currentMode();
}

/* The step's instruction, worded for the device in hand. */
function stepText(step) {
  return instructionFor(step?.text || "", mode(), step);
}

function stepTask(step) {
  return taskFor(step, mode());
}

/*
 * ============================================================
 * THE TUTORIAL IS ALREADY OPEN, SO HELP IS NEVER THE TARGET
 * ============================================================
 *
 * The route into a tutorial is Help -> User Guide -> section -> tutorial, so by
 * the time its steps run the door has already been walked through. A step that
 * points at (or hands the first press to) the Help label sends the student back
 * to the menu they just left, and every tutorial used to begin with one.
 *
 * The authored table no longer contains such a step (see `guide-content.js`),
 * and this is the runtime half of the same rule: whatever arrives, a Help menu
 * target is replaced by the first step's own real control, so a stale or future
 * definition cannot reintroduce the highlight.
 */
function isHelpMenuTarget(target) {
  return (
    target?.kind === "menu" &&
    /^(help|user-?guide)$/i.test(String(target.id || ""))
  );
}

function tutorialStep(index) {
  const step = tutorial?.steps?.[index] || null;

  if (!step || !isHelpMenuTarget(step.target)) {
    return step;
  }

  const replacement = (tutorial.steps || []).find(
    (candidate) => candidate !== step && candidate?.target && !isHelpMenuTarget(candidate.target),
  );

  return replacement ? { ...step, target: replacement.target } : step;
}

/*
 * ============================================================
 * THE SPOTLIGHT
 * ============================================================
 *
 * Four strips around the target leave a genuine hole, so the control is at full
 * brightness and the student can see exactly what the instruction means. A
 * single `box-shadow: 0 0 0 9999px` ring would darken the target too, which
 * defeats the point.
 */
function applyScrim(hole) {
  const { left, top, right, bottom } = hole;

  scrim.querySelector("[data-scrim-top]").style.cssText =
    `left:0;top:0;width:100%;height:${Math.max(0, top)}px;`;

  scrim.querySelector("[data-scrim-bottom]").style.cssText =
    `left:0;top:${bottom}px;width:100%;bottom:0;`;

  scrim.querySelector("[data-scrim-left]").style.cssText =
    `left:0;top:${top}px;width:${Math.max(0, left)}px;height:${Math.max(0, bottom - top)}px;`;

  scrim.querySelector("[data-scrim-right]").style.cssText =
    `left:${right}px;top:${top}px;right:0;height:${Math.max(0, bottom - top)}px;`;
}

function applyRing(hole) {
  ring.style.left = `${hole.left}px`;
  ring.style.top = `${hole.top}px`;
  ring.style.width = `${hole.width}px`;
  ring.style.height = `${hole.height}px`;
}

/* The viewport rectangle of an element, or null when it has no box. */
function roundOf(element) {
  const rect = element?.getBoundingClientRect?.();

  return rect && (rect.width || rect.height)
    ? { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right }
    : null;
}

/*
 * ============================================================
 * WHERE THE PANEL SITS
 * ============================================================
 *
 * The instruction panel belongs along the TOP edge of the workspace - above the
 * drawing, beside the header - because that is the one strip of the window that
 * is never the thing being pointed at. It is centred there, and clamped inside
 * the viewport so it cannot be pushed off either edge.
 *
 * When the target IS in that top strip (a menu label, a toolset button), the
 * panel moves to just below it rather than covering it - the one case where the
 * "always at the top" rule would hide the very control being taught.
 */
function placePanel(hole) {
  const margin = 16;

  panel.style.left = "-9999px";
  panel.style.top = `${margin}px`;

  const size = panel.getBoundingClientRect();

  const panelWidth = size.width || 420;
  const panelHeight = size.height || 160;

  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  const headerRect = header?.getBoundingClientRect();

  /*
   * THE PANEL SITS DIRECTLY UNDER THE HEADER BAR - AND UNDER THE MENU ROW.
   *
   * That strip is the one place in the window that is never the thing being
   * pointed at - the canvas is below it and the tools are at the sides - so the
   * panel lives there by default. Two rows are excluded rather than one: the
   * tutorial header, and the application's own menu/toolset rail beneath it,
   * which a step about "the toolbar" is pointing INTO. When the target itself
   * is in that strip the panel moves below or above it instead.
   */
  const rail =
    document.querySelector(".drawing-top-rail") ||
    document.querySelector(".drawing-menu-controls-bar");

  const railBottom = rail?.getBoundingClientRect?.().bottom || 0;

  const topBand = Math.max(
    margin,
    Math.round(Math.max(headerRect?.bottom || 0, railBottom)) + 10,
  );

  const overlapsTopBand =
    hole.top < topBand + panelHeight + margin &&
    hole.bottom > topBand &&
    hole.left < viewportWidth &&
    hole.right > 0;

  /*
   * A CANVAS STEP MUST NOT COVER THE SHEET.
   *
   * A step about the drawing area asks the student to DRAG on it, and a panel
   * floating in the top band of the canvas would swallow exactly the gesture it
   * is teaching - the press would land on the panel and the drawing step would
   * read as "no rectangle was made". So a canvas step keeps its instruction in
   * the HEADER's band, above the drawing, and never over it.
   */
  const targetIsCanvas = currentStep?.target?.kind === "canvas";

  let left = viewportWidth / 2 - panelWidth / 2;
  let top = topBand;

  /* The top of the sheet, measured, so the panel can be held above it. */
  const canvasTop = targetIsCanvas
    ? roundOf(document.querySelector(".drawing-canvas"))?.top
    : null;

  if (targetIsCanvas && Number.isFinite(canvasTop)) {
    /*
     * ABOVE THE SHEET IF IT FITS, otherwise just inside its top edge - never
     * across the middle of it, which is where the demonstration and the
     * student's own drag happen.
     */
    top = canvasTop - panelHeight - margin;

    if (top < topBand) {
      top = Math.max(topBand, canvasTop + margin);
    }
  }

  if (overlapsTopBand && !targetIsCanvas && hole.top < topBand + panelHeight + margin) {
    /*
     * THE TARGET IS IN THAT STRIP. The panel goes BELOW it, on the other side of
     * the target from the top of the window - which is always where there is
     * room, because the drawing is beneath everything.
     */
    top = hole.bottom + margin;
  }

  /* A target under the panel is never left covered: the panel moves down. */
  const wouldCover =
    !targetIsCanvas &&
    top < hole.bottom &&
    top + panelHeight > hole.top &&
    left < hole.right &&
    left + panelWidth > hole.left;

  if (wouldCover) {
    const below = hole.bottom + margin;

    if (below + panelHeight < viewportHeight - margin) {
      top = below;
    }
  }

  left = Math.min(Math.max(margin, left), viewportWidth - panelWidth - margin);
  top = Math.min(Math.max(margin, top), viewportHeight - panelHeight - margin);

  panel.style.left = `${Math.round(left)}px`;
  panel.style.top = `${Math.round(top)}px`;
}

/*
 * ============================================================
 * THE VISUAL GUIDE
 * ============================================================
 *
 * A pointer that travels once from the instruction panel to the target, then
 * stops and stays put. Its SHAPE says which device is in hand: an angled arrow
 * with a halo around its tip for a mouse, a fingertip with a contact halo for a
 * touchscreen.
 *
 * IT IS A HELP CURSOR, NOT THE STUDENT'S POINTER, and it is drawn so nobody
 * confuses the two: academic gold on a dark green outline, a thin ringed halo
 * around the tip that is empty in the middle, and one brief emphasis on arrival.
 * The real pointer is left entirely alone - this marks never move it.
 *
 * WHICH WAY THE TIP POINTS MATTERS. The mark is placed so its TIP sits on the
 * target, not its middle: a help cursor whose point is over the button names
 * the button, and one whose centre is over the button names nothing. The tip
 * offset is declared here, in one place, and the sheet uses the same numbers.
 *
 * IT RUNS ONCE. There is no interval and no loop - `guideOnce` is called when a
 * step appears and when the layout changes, and nothing repeats it.
 */

/* Where the tip sits inside the mark, in mark pixels, per device. */
const POINTER_TIP = { laptop: 5, touch: 17 };

/* The mark's box, in pixels. Kept in step with `.datum-tutorial-pointer-dot`. */
const POINTER_SIZE = { laptop: 34, touch: 42 };

function pointerMarkup(modeName) {
  const touch = modeName === "touch";

  /*
   * THE HALO IS A SEPARATE ELEMENT from the arrow so it can stay circular and
   * centred on the tip while the arrow itself is angled - one SVG would have to
   * rotate the ring with the cursor, which no help cursor does.
   */
  const halo = `<span class="datum-tutorial-pointer-halo" aria-hidden="true"></span>`;

  return `
    <span class="datum-tutorial-pointer-trail" aria-hidden="true"></span>
    ${halo}
    <span class="datum-tutorial-pointer-dot" aria-hidden="true">
      ${
        touch
          ? /* A fingertip, angled like a stylus, pointing down-right. */
            `<svg viewBox="0 0 24 24" width="42" height="42" focusable="false">
               <g transform="rotate(-18 12 12)">
                 <path d="M12 3.4c2.4 0 4.2 1.9 4.2 4.3v6.1a4.2 4.2 0 0 1-8.4 0V7.7c0-2.4 1.8-4.3 4.2-4.3z"
                   fill="none" stroke="var(--datum-tutorial-pointer-outline)" stroke-width="2.9" stroke-linejoin="round"/>
                 <path d="M12 3.4c2.4 0 4.2 1.9 4.2 4.3v6.1a4.2 4.2 0 0 1-8.4 0V7.7c0-2.4 1.8-4.3 4.2-4.3z"
                   fill="currentColor" stroke="#FFFFFF" stroke-width=".8"/>
                 <circle cx="12" cy="19.4" r="2.1" fill="currentColor" stroke="#FFFFFF" stroke-width=".6"/>
               </g>
             </svg>`
          : /* An arrow cursor, angled the way a pointer is held, tip at 3,3. */
            `<svg viewBox="0 0 24 24" width="34" height="34" focusable="false">
               <path d="M3 3l6.6 17.2 2.5-6.7 6.7-2.5z"
                 fill="none" stroke="var(--datum-tutorial-pointer-outline)"
                 stroke-width="2.4" stroke-linejoin="round"/>
               <path d="M3 3l6.6 17.2 2.5-6.7 6.7-2.5z" fill="currentColor"
                 stroke="#FFFFFF" stroke-width=".7" stroke-linejoin="round"/>
               <path d="M5.4 6.2L8.5 14.3" fill="none" stroke="var(--datum-tutorial-pointer-outline)"
                 stroke-width="1" stroke-linecap="round" opacity=".4"/>
             </svg>`
      }
    </span>
  `;
}

/*
 * DRAW THE GUIDE FOR ONE STEP.
 *
 * THE MARK TRAVELS. It starts where it finished the previous step - so the
 * student watches one pointer move around the interface, the way a person's
 * runs - and eases to the new target's centre, overshooting nothing, then
 * stops. Only the very first step of a tutorial has no previous position to
 * come from, and that one starts at the instruction panel.
 *
 * IT IS ANIMATED BY SCRIPT, NOT BY A CSS TRANSITION. A transition on
 * `left`/`top` starts whenever the value changes, so a step change during a
 * journey would race the previous transition and the distance would be walked
 * at the wrong speed. One frame loop, cancelled by `pointerRun`, gives one
 * journey, at one pace, with one end - and lets the arrival be announced from
 * the same place the movement ends.
 */

/*
 * WHERE THE MARK IS RIGHT NOW, in viewport pixels, or null before the first
 * journey. Every journey starts from here; every journey ends by writing here.
 */
let pointerAt = null;

/* Identifies the current journey; an older frame loop sees a different run. */
let pointerRun = 0;

function guideOnce(hole, { animate = true } = {}) {
  if (!pointer) {
    return;
  }

  const run = (pointerRun += 1);

  const device = mode();

  /*
   * THE MARK IS ONLY REBUILT WHEN THE DEVICE CHANGED. Re-running `innerHTML`
   * on every step would replace the node the frame loop is moving - and would
   * drop its opacity classes, which is what made the mark appear to fade in at
   * each destination rather than fly to it.
   */
  const deviceChanged = pointer.dataset.mode !== device;

  pointer.dataset.mode = device;

  if (!pointer.firstElementChild || deviceChanged) {
    pointer.innerHTML = pointerMarkup(device);
  }

  const shape = markGeometry(device);

  pointer.style.setProperty("--datum-tutorial-tip-x", `${shape.offset}px`);
  pointer.style.setProperty("--datum-tutorial-tip-y", `${shape.offset}px`);

  const panelRect = panel.getBoundingClientRect();

  const centre = {
    x: hole.left + hole.width / 2,
    y: hole.top + hole.height / 2,
  };

  /*
   * WHERE IT SETS OFF FROM.
   *
   * The place it was left; failing that - the first step of a tutorial - the
   * bottom of the instruction panel, which is where its words come from. It is
   * clamped into the window so a journey never starts off-screen.
   */
  const from = pointerAt || {
    x: Math.min(Math.max(panelRect.left + panelRect.width / 2, 24), window.innerWidth - 24),
    y: Math.min(Math.max(panelRect.top + panelRect.height, 24), window.innerHeight - 24),
  };

  const to = clampToViewport(centre);

  /* A fresh step shows the mark at once; there is nothing to fade in. */
  pointer.classList.add("datum-tutorial-pointer-live");
  pointer.classList.remove("datum-tutorial-pointer-arrived");

  const arrive = () => {
    if (run !== pointerRun) {
      return;
    }

    pointerAt = { x: to.x, y: to.y };

    pointer?.classList.add("datum-tutorial-pointer-arrived");
    ring?.classList.add("datum-tutorial-ring-arrived");
  };

  /*
   * A LAYOUT CHANGE PLACES THE MARK; IT DOES NOT WALK IT THERE AGAIN. The
   * student has already been shown the target, and replaying the journey on
   * every resize would be a distraction rather than a demonstration.
   */
  if (!animate) {
    placeMarkAt(to, shape);
    arrive();

    return;
  }

  animateMark(from, to, shape, run, arrive);
}

/* The mark's own box, so its TIP can be put exactly on the target. */
function markGeometry(device) {
  const size = POINTER_SIZE[device] ?? POINTER_SIZE.laptop;
  const half = size / 2;
  const tip = POINTER_TIP[device] ?? POINTER_TIP.laptop;

  return { size, half, tip, offset: tip - half };
}

/* Put the mark's position so its tip sits on `point`. */
function placeMarkAt(point, shape) {
  if (!pointer) {
    return;
  }

  pointer.style.left = `${point.x + shape.half - shape.tip}px`;
  pointer.style.top = `${point.y + shape.half - shape.tip}px`;
}

/* Keeping a journey inside the window, so it never runs off the edge. */
function clampToViewport(point) {
  return {
    x: Math.min(Math.max(point.x, 8), Math.max(8, window.innerWidth - 8)),
    y: Math.min(Math.max(point.y, 8), Math.max(8, window.innerHeight - 8)),
  };
}

/*
 * THE JOURNEY ITSELF.
 *
 * A pointer motor: it accelerates out of the start, cruises, and settles onto
 * the target - the curve a hand makes, and the reason the movement reads as a
 * person rather than as a tween. The distance decides the duration (a short hop
 * must not crawl), within bounds so nothing feels rushed or sluggish.
 */
function animateMark(from, to, shape, run, done, { guard = () => true } = {}) {
  const distance = Math.hypot(to.x - from.x, to.y - from.y);

  const duration = Math.min(
    1100,
    Math.max(320, POINTER_TRAVEL_MS + distance * 0.55),
  );

  const started = performance.now();

  /* A tiny arc, so the path is not a mechanical straight line. */
  const bend = Math.min(38, distance * 0.12);
  const normal = distance
    ? { x: -(to.y - from.y) / distance, y: (to.x - from.x) / distance }
    : { x: 0, y: 0 };

  const frame = (now) => {
    if (run !== pointerRun || !pointer || !guard()) {
      return;
    }

    const t = Math.min(1, Math.max(0, (now - started) / duration));

    /* Ease out, with a gentle start rather than a jerk. */
    const eased = t * t * (3 - 2 * t);

    const bow = Math.sin(Math.PI * t) * bend;

    placeMarkAt(
      {
        x: from.x + (to.x - from.x) * eased + normal.x * bow,
        y: from.y + (to.y - from.y) * eased + normal.y * bow,
      },
      shape,
    );

    if (t < 1) {
      requestAnimationFrame(frame);

      return;
    }

    placeMarkAt(to, shape);

    done();
  };

  requestAnimationFrame(frame);
}

/* Whether a step is one the sheet can demonstrate - see `guide-demo.js`. */
function hasDemo(step) {
  return Boolean(
    step?.action &&
      demoFor(step, { centre: { x: 0, y: 0 }, units: { width: 1, height: 1 } }),
  );
}

/*
 * ============================================================
 * THE CANVAS DEMONSTRATION
 * ============================================================
 *
 * A step that asks for WORK on the sheet - draw a line, drag a rectangle,
 * place a point - cannot be taught by pointing at a button. The student has to
 * see WHERE and HOW BIG, so the help cursor acts the gesture out: it travels
 * from the demonstrated start to the demonstrated end, leaves a faint trail
 * behind it, and the two endpoints stay marked afterwards.
 *
 * IT DRAWS NOTHING. The path is a separate, absolutely-positioned overlay: an
 * SVG line, two rings and the same pointer mark used everywhere else. No mouse
 * event is dispatched, no tool is armed, no object is created, and the canvas
 * itself is never touched - the student does the work, and only the student.
 *
 * IT HAPPENS ONCE. `runDemo` is called when a step is rendered and when the
 * layout changes (redrawn in place then, not replayed). Every frame is cancelled
 * on the next step, on a mode change and on teardown, so nothing is left
 * running behind a tutorial that has moved on.
 */

function clearDemoTimers() {
  demoTimers.forEach((timer) => {
    window.clearTimeout(timer);
    window.clearInterval(timer);
  });

  demoTimers = [];
}

function clearDemo() {
  demoRun += 1;

  clearDemoTimers();

  if (demoLayer) {
    demoLayer.remove();
  }

  demoLayer = null;
  demoStart = null;
  demoEnd = null;
}

/* The element that carries one demonstration shape. */
function demoElement(cls) {
  const node = document.createElement("div");
  node.className = cls;
  node.setAttribute("aria-hidden", "true");
  demoLayer.append(node);

  return node;
}

/*
 * THE DEMONSTRATION STARTS BELOW THE INSTRUCTION PANEL.
 *
 * The panel sits at the top of the sheet for a canvas step, and a gesture
 * demonstrated underneath it would have its first half hidden behind the
 * words. The start point is therefore pushed below the panel's bottom edge
 * whenever the natural one would fall behind it.
 */
function demoPoints(step, frame, camera) {
  if (!step?.action || !frame || !camera) {
    return null;
  }

  const shape = demoShape(step, frame, camera);

  if (!shape) {
    return null;
  }

  const panelRect = panel?.getBoundingClientRect();

  if (panelRect && panelRect.height) {
    const floor = panelRect.bottom + 28;

    if (shape.from.y < floor) {
      const dy = floor - shape.from.y;

      shape.from = { x: shape.from.x, y: shape.from.y + dy };

      if (shape.via) {
        shape.via = { x: shape.via.x, y: shape.via.y + dy };
      }

      if (shape.to) {
        shape.to = { x: shape.to.x, y: shape.to.y + dy };
      }
    }
  }

  return shape;
}

/* The demonstration, converted to screen pixels. */
function demoShape(step, frame, camera) {
  const spec = demoFor(step, demoView(frame, camera));

  if (!spec) {
    return null;
  }

  return {
    kind: spec.kind,
    from: toScreen(spec.from, frame, camera),
    via: spec.via ? toScreen(spec.via, frame, camera) : null,
    to: spec.to ? toScreen(spec.to, frame, camera) : null,
  };
}

/*
 * A MARKER THAT SPEAKS THE DEVICE'S LANGUAGE.
 *
 * A mouse press is a ring round a point; a finger or stylus leaves a filled
 * disc, as a real touch does. Neither is a cursor and neither pretends to act.
 */
function placeDemoMarker(node, point, label) {
  node.style.left = `${point.x}px`;
  node.style.top = `${point.y}px`;
  node.dataset.label = label;
  node.dataset.mode = mode();
}

/*
 * RUN THE DEMONSTRATION FOR ONE STEP.
 *
 * `animate` is false when the step is being REDRAWN rather than entered - a
 * resize or a zoom keeps the mark where the gesture ended instead of acting it
 * out a second time.
 */
function runDemo(step, { animate = true } = {}) {
  clearDemo();

  if (!overlay || !hasDemo(step)) {
    return;
  }

  const frame = canvasFrame();

  if (!frame) {
    return;
  }

  const run = demoRun;

  /*
   * THE JOURNEY AND THE GESTURE ARE ONE ANIMATION SEQUENCE.
   *
   * `animateMark` moves the SAME pointer the guide moves, so its cancellation
   * is shared with `pointerRun`; the demo's own run id is added as a second
   * guard so a step change cancels either half. Without the shared id the
   * journey's frames - which belong to the pointer - would never see the demo's
   * run change and would keep pushing the mark after the step had moved on.
   */
  const pointerJourney = (pointerRun += 1);

  const alive = () => run === demoRun && pointerJourney === pointerRun;

  demoLayer = document.createElement("div");
  demoLayer.className = "datum-tutorial-demo";
  demoLayer.setAttribute("aria-hidden", "true");

  /* The trail goes underneath the markers; the pointer goes on top. */
  const trail = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  trail.setAttribute("class", "datum-tutorial-demo-trail");
  trail.setAttribute("focusable", "false");
  demoLayer.append(trail);

  const line = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
  line.setAttribute("class", "datum-tutorial-demo-line");
  line.setAttribute("fill", "none");
  trail.append(line);

  /*
   * THE GOLD RULE, OVER THE INK ONE. Two elements rather than one stroke with a
   * `paint-order`: the pair is what keeps the path visible on a white sheet and
   * on the dark canvas, and both are drawn from the same dash offset so they
   * never disagree about how much of the gesture has happened.
   */
  const gold = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
  gold.setAttribute("class", "datum-tutorial-demo-line datum-tutorial-demo-gold");
  gold.setAttribute("fill", "none");
  trail.append(gold);

  demoStart = demoElement("datum-tutorial-demo-marker");
  demoStart.classList.add("datum-tutorial-demo-start");

  demoEnd = demoElement("datum-tutorial-demo-marker");
  demoEnd.classList.add("datum-tutorial-demo-end");

  overlay.append(demoLayer);

  const draw = () => {
    if (run !== demoRun || !demoLayer) {
      return Promise.resolve(null);
    }

    const current = canvasFrame();

    return cameraOf().then((camera) => {
      if (run !== demoRun || !demoLayer || !camera) {
        return null;
      }

      const points = demoPoints(step, current, camera);

      if (!points) {
        return null;
      }

      const { from, to } = points;

      trail.setAttribute("width", String(window.innerWidth));
      trail.setAttribute("height", String(window.innerHeight));

      placeDemoMarker(demoStart, from, "Start");

      if (to) {
        placeDemoMarker(demoEnd, to, "End");
        demoEnd.hidden = false;

        /* A path that curves gets its middle point; a straight one does not. */
        const pointsAttr = points.via
          ? `${from.x},${from.y} ${points.via.x},${points.via.y} ${to.x},${to.y}`
          : `${from.x},${from.y} ${to.x},${to.y}`;

        [line, gold].forEach((rule) => {
          rule.setAttribute("points", pointsAttr);
        });

        /* The trail is drawn by the gesture, so its length is its own. */
        const length = pathLength(
          points.via ? [from, points.via, to] : [from, to],
        );

        [line, gold].forEach((rule) => {
          rule.style.strokeDasharray = `${length}`;
          rule.style.strokeDashoffset = animate ? `${length}` : "0";
        });
      } else {
        demoEnd.hidden = true;
        line.setAttribute("points", "");
        gold.setAttribute("points", "");
      }

      return { ...points, line, gold };
    });
  };

  if (!animate) {
    draw().then((points) => {
      if (!points || !demoLayer) {
        return;
      }

      demoLayer.classList.add("datum-tutorial-demo-shown");
      demoLayer.classList.add("datum-tutorial-demo-arrived");
      demoLayer.dataset.mode = mode();

      if (!points.to) {
        demoLayer.classList.add("datum-tutorial-demo-point");
      }

      /*
       * THE MARK IS PUT BACK WHERE THE GESTURE ENDED. A resize or a zoom
       * redraws the demonstration in place; it does not act it out again.
       */
      const resting = points.to || points.from;

      placePointerAt(resting);
      pointerAt = { x: resting.x, y: resting.y };

      pointer?.classList.add("datum-tutorial-pointer-arrived");
      ring?.classList.add("datum-tutorial-ring-arrived");
    });

    return;
  }

  /*
   * THE SEQUENCE, AND WHY IT IS THIS ONE.
   *
   * The mark first TRAVELS to the place the gesture begins - it does not appear
   * there - so one pointer is seen moving around the sheet the whole way
   * through. The start marker then appears under it, the pointer draws the
   * gesture itself, and the endpoint is marked as it lands. A short pause
   * between the phases is what makes it read as an action rather than a flash.
   */
  draw().then((points) => {
    if (!points || !demoLayer) {
      return;
    }

    demoLayer.classList.add("datum-tutorial-demo-shown");
    demoLayer.classList.add(`datum-tutorial-demo-${mode()}`);

    /* The mark is on screen for the whole demonstration, not faded in. */
    pointer.classList.add("datum-tutorial-pointer-live");
    pointer.classList.remove("datum-tutorial-pointer-arrived");

    const device = mode();
    const shape = markGeometry(device);

    pointer.dataset.mode = device;

    if (!pointer.firstElementChild) {
      pointer.innerHTML = pointerMarkup(device);
    }

    pointer.style.setProperty("--datum-tutorial-tip-x", `${shape.offset}px`);
    pointer.style.setProperty("--datum-tutorial-tip-y", `${shape.offset}px`);

    const journeyFrom = pointerAt || {
      x: Math.min(Math.max(panel.getBoundingClientRect().left + 40, 24), window.innerWidth - 24),
      y: Math.min(Math.max(panel.getBoundingClientRect().bottom, 24), window.innerHeight - 24),
    };

    const settle = (resting) => {
      pointerAt = { x: resting.x, y: resting.y };

      demoLayer.classList.add("datum-tutorial-demo-arrived");
      pointer?.classList.add("datum-tutorial-pointer-arrived");
      ring?.classList.add("datum-tutorial-ring-arrived");
    };

    /* A single point is placed, not dragged: travel there, then settle. */
    if (!points.to) {
      demoLayer.classList.add("datum-tutorial-demo-point");

      animateMark(journeyFrom, points.from, shape, pointerJourney, () => settle(points.from), {
        guard: alive,
      });

      return;
    }

    /* 1. Travel to where the gesture starts. 2. Draw it. 3. Mark the end. */
    animateMark(journeyFrom, points.from, shape, pointerJourney, () => {
      if (!alive() || !demoLayer) {
        return;
      }

      pointerAt = { x: points.from.x, y: points.from.y };

      travelDemo(points, () => {
        if (!alive() || !demoLayer) {
          return;
        }

        settle(points.to);
      });
    }, { guard: alive });
  });
}

/* The mark's box is centred on its position, so it is offset by the tip. */
function placePointerAt(point) {
  if (!pointer || !point) {
    return;
  }

  pointer.style.transition = "none";
  placeMarkAt(point, markGeometry(mode()));
}

/*
 * THE POINTER'S TRAVEL, AND THE TRAIL BEHIND IT.
 *
 * Both are driven from the SAME two live points - the mark by left/top, the
 * trail by its dash offset - so they cannot disagree, and a layout change that
 * re-measures the canvas moves both with the sheet.
 */
function travelDemo({ from, to, via }, done) {
  if (!pointer || !to || !demoLayer) {
    return;
  }

  const run = demoRun;

  demoLayer.classList.add("datum-tutorial-demo-travelling");

  /*
   * THE RULES ARE HELD ONCE, NOT QUERIED PER FRAME. Two of them (ink and gold)
   * share one path and one length; reading the DOM inside a 60fps loop would be
   * work for nothing.
   */
  const rules = [...demoLayer.querySelectorAll(".datum-tutorial-demo-line")];

  const path = via ? [from, via, to] : [from, to];

  const length = pathLength(path);

  const started = performance.now();

  /*
   * THE MARK FOLLOWS THE PATH, not the straight line between its ends, so an
   * arc's demonstration curves through its own middle point exactly as the
   * drawn arc would.
   */
  const along = (t) => {
    const total = length || 1;
    let travelled = t * total;

    for (let index = 1; index < path.length; index += 1) {
      const a = path[index - 1];
      const b = path[index];
      const leg = Math.hypot(b.x - a.x, b.y - a.y);

      if (travelled <= leg || index === path.length - 1) {
        const f = leg ? Math.min(1, travelled / leg) : 1;

        return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
      }

      travelled -= leg;
    }

    return to;
  };

  const frame = (now) => {
    if (run !== demoRun || !pointer || !demoLayer) {
      return;
    }

    const t = Math.min(1, Math.max(0, (now - started) / DEMO_TRAVEL_MS));

    /* An ease-out curve: the pointer sets off and settles, as a hand does. */
    const eased = 1 - Math.pow(1 - t, 2.1);

    placePointerAt(along(eased));

    if (rules.length) {
      const offset = `${length * (1 - eased)}`;

      rules.forEach((rule) => {
        rule.style.strokeDashoffset = offset;
      });
    }

    if (t < 1) {
      requestAnimationFrame(frame);

      return;
    }

    demoLayer.classList.remove("datum-tutorial-demo-travelling");

    done?.();
  };

  requestAnimationFrame(frame);
}

/* The pixel length of a demonstrated path, for the trail's own dash. */
function pathLength(points) {
  return points.reduce(
    (total, point, index) =>
      index === 0
        ? total
        : total + Math.hypot(point.x - points[index - 1].x, point.y - points[index - 1].y),
    0,
  );
}

/*
 * ============================================================
 * RENDERING A STEP
 * ============================================================
 */

/*
 * THE HOLE FOR A STEP, MEASURED ONCE AND USED EVERYWHERE.
 *
 * Four places need it - the step's first render, a layout change, a completed
 * action and a mode change - and four copies of the fallback arithmetic is four
 * chances for one of them to point somewhere else. It is written once here.
 *
 * The order is: the real control, then its container, then a conservative
 * rectangle deliberately BELOW the menu bar rather than under it.
 */
function holeForStep(step) {
  const element = findTarget(step?.target);

  const fallback = element ? null : fallbackTarget(step?.target);

  const measured = rectOf(element) ||
    rectOf(fallback) || {
      left: 24,
      top: 140,
      width: Math.max(160, window.innerWidth - 48),
      height: Math.max(120, window.innerHeight - 260),
      right: window.innerWidth - 24,
      bottom: window.innerHeight - 120,
    };

  return inflate(measured, 6);
}

function renderStep({ animate = true } = {}) {
  if (!tutorial) {
    return;
  }

  currentStep = tutorialStep(stepIndex);

  if (!currentStep) {
    return;
  }

  stepState = { status: "pending", baseline: null, feedback: null };
  advancing = false;

  /*
   * THE FALLBACK IS THE TARGET'S OWN CONTAINER, never "the canvas" - see
   * `fallbackTarget`. A canvas rect lies under the menu row, so a ring drawn
   * there appears on the menu bar.
   */
  const hole = holeForStep(currentStep);

  lastHole = hole;

  applyScrim(hole);
  applyRing(hole);

  ring.classList.remove("datum-tutorial-ring-arrived");

  renderHeader();
  renderPanel();

  placePanel(hole);

  /*
   * A CANVAS STEP IS DEMONSTRATED, NOT POINTED AT.
   *
   * The step's own action says what the student must draw; `guide-demo.js`
   * turns that into a gesture in drawing coordinates, and the pointer acts it
   * out once and leaves the endpoints marked. There is no ring on the canvas in
   * that case - the demonstration itself is the target.
   */
  if (hasDemo(currentStep)) {
    ring.classList.remove("datum-tutorial-ring-arrived");
    pointer.dataset.mode = mode();
    pointer.innerHTML = pointerMarkup(mode());
    runDemo(currentStep, { animate });
  } else {
    clearDemo();
    guideOnce(hole, { animate });
  }

  startActionWatch();

  announce(
    `Step ${stepIndex + 1} of ${totalSteps()}. ${currentStep.title}. ${stepText(
      currentStep,
    )}`,
  );
}

/*
 * THE HEADER: the tutorial's name, the count, the progress, the device control
 * and Cancel. Compact by design - it is a title bar, not a dashboard.
 */
function renderHeader() {
  const count = totalSteps();
  const progress = Math.round((stepIndex / count) * 100);

  header.innerHTML = `
    <div class="datum-tutorial-header-main">
      <span class="datum-tutorial-eyebrow">Tutorial</span>
      <h2 class="datum-tutorial-title">${escapeHtml(tutorial.title)}</h2>
    </div>

    <div class="datum-tutorial-header-progress">
      <span class="datum-tutorial-counter" data-tutorial-counter>
        Step ${stepIndex + 1} of ${count}
      </span>
      <span class="datum-tutorial-progress" role="progressbar"
        aria-valuemin="0" aria-valuemax="${count}" aria-valuenow="${stepIndex}"
        aria-label="Tutorial progress">
        <span class="datum-tutorial-progress-fill" style="width:${progress}%"></span>
      </span>
    </div>

    ${deviceSelectHtml({ id: "datumTutorialDevice", className: "datum-device-compact" })}

    <button type="button" class="datum-tutorial-exit" data-tutorial-exit>
      Cancel
    </button>
  `;

  bindDeviceSelect(header);
}

/*
 * THE INSTRUCTION PANEL: what to do, for this device, plus the one line that
 * says the work is the student's.
 */
function renderPanel() {
  const step = currentStep;
  const gated = Boolean(step.action);
  const done = stepState.status === "done";

  const missing = !findTarget(step.target);

  const targetLabel = step.target?.label
    ? ` on ${step.target.label}`
    : "";

  panel.innerHTML = `
    <div class="datum-tutorial-panel-head">
      <h3 class="datum-tutorial-step-title">${escapeHtml(step.title)}</h3>
      <span class="datum-tutorial-gesture">${escapeHtml(
        gestureLabel(step.gesture, mode()),
      )}</span>
    </div>

    <p class="datum-tutorial-step-text">${escapeHtml(stepText(step))}</p>

    ${
      gated && !done
        ? `<p class="datum-tutorial-task" data-tutorial-task>
             <span class="datum-tutorial-task-label">Your turn</span>
             ${escapeHtml(stepTask(step))}
           </p>`
        : ""
    }

    <p class="datum-tutorial-feedback" data-tutorial-feedback hidden></p>

    ${
      done && !isFinalStep()
        ? `<p class="datum-tutorial-success" data-tutorial-success>
             Done - moving on.
           </p>`
        : ""
    }

    ${
      done && isFinalStep()
        ? `<div class="datum-tutorial-finish" data-tutorial-finish>
             <p class="datum-tutorial-complete" data-tutorial-complete>
               <strong>Tutorial complete.</strong>
               Every step is done - nothing in your own drawing has changed.
             </p>
             <button type="button"
               class="datum-tutorial-button datum-tutorial-button-primary"
               data-tutorial-done>
               Done
             </button>
           </div>`
        : ""
    }

    ${
      missing && targetLabel
        ? `<p class="datum-tutorial-note">
             The control${escapeHtml(targetLabel)} may need its panel or menu open first.
           </p>`
        : ""
    }

    ${
      !gated
        ? `<div class="datum-tutorial-finish">
             ${
               isFinalStep()
                 ? `<p class="datum-tutorial-complete">
                      That is the whole tutorial. Nicely worked.
                    </p>`
                 : ""
             }
             <button type="button"
               class="datum-tutorial-button datum-tutorial-button-primary"
               data-tutorial-${isFinalStep() ? "done" : "continue"}>
               ${isFinalStep() ? "Done" : "Continue"}
             </button>
           </div>`
        : ""
    }

    <!--
      PREVIOUS, WHEREVER THERE IS SOMETHING TO GO BACK TO.

      It is NOT a way forward - a step is left by doing it - so it cannot
      bypass an action. What it is for is the student who wants to re-read the
      step they just did, which is exactly as valid a need in a tutorial as in
      a book. It is absent on the first step because there is nothing behind it.
    -->
    ${
      stepIndex > 0
        ? `<div class="datum-tutorial-back">
             <button type="button" class="datum-tutorial-button"
               data-tutorial-previous>&larr; Previous step</button>
           </div>`
        : ""
    }
  `;

  panel
    .querySelector("[data-tutorial-previous]")
    ?.addEventListener("click", previousStep);

  if (stepState.feedback) {
    setFeedback(stepState.feedback, "wrong");
  }

  panel
    .querySelector("[data-tutorial-done]")
    ?.addEventListener("click", finish);

  /*
   * ON A FINAL, INFORMATIONAL STEP THE BUTTON IS DONE, and Done ends the
   * tutorial - there is no later step for Continue to reach.
   */
  panel
    .querySelector("[data-tutorial-continue]")
    ?.addEventListener("click", continueInformational);
}

/* A one-line message under the instruction, replaced in place. */
function setFeedback(message, tone = "info") {
  stepState.feedback = message;

  const slot = panel?.querySelector("[data-tutorial-feedback]");

  if (!slot) {
    return;
  }

  slot.dataset.tone = message ? tone : "none";
  slot.textContent = message || "";
  slot.hidden = !message;
}

/*
 * ============================================================
 * WATCHING FOR THE ACTION
 * ============================================================
 *
 * The checks are in `guide-actions.js`; this is the loop that asks them and the
 * one place that reacts. An informational step needs no watching - it has
 * nothing to validate, so it is advanced when the student is ready, by the
 * single control the header offers for that purpose.
 */
async function startActionWatch() {
  stopActionWatch();

  if (!currentStep?.action) {
    return;
  }

  const actions = await import("./guide-actions.js");

  if (!overlay || !currentStep?.action) {
    return;
  }

  /*
   * A BASELINE THAT CANNOT BE TAKEN IS STILL A BASELINE.
   *
   * The watch used to `await` this unconditionally, so one throw - a module
   * that was not ready, a listener that threw on an unexpected event - rejected
   * the whole function: no baseline, no interval, and a step that could never
   * be validated. A null baseline makes the checks treat everything as
   * outstanding, which is the safe direction: the student performs the action
   * and it is still recognised, rather than the tutorial going quiet.
   */
  try {
    stepState.baseline = await actions.baseline();
  } catch (error) {
    stepState.baseline = null;
  }

  if (!overlay || !currentStep?.action) {
    return;
  }

  const tick = async () => {
    if (!currentStep?.action || !overlay || advancing) {
      return;
    }

    let result;

    try {
      result = await actions.check(currentStep.action, stepState.baseline);
    } catch (error) {
      /* A check that cannot read the model is "not yet", never "done". */
      return;
    }

    if (!result || !overlay || advancing) {
      return;
    }

    if (result.done) {
      markStepComplete(result);
      return;
    }

    /*
     * A CORRECTION IS SAID ONCE PER KIND OF MISTAKE, not on every poll - a
     * panel that re-rendered itself several times a second would be unreadable.
     */
    if (result.wrong && result.wrong !== stepState.feedback) {
      setFeedback(result.wrong, "wrong");
    } else if (!result.wrong && stepState.feedback) {
      setFeedback(null);
    }
  };

  actionTimer = window.setInterval(tick, ACTION_POLL_MS);

  /* Once immediately, so an action already satisfied does not wait a tick. */
  tick();
}

function stopActionWatch() {
  if (actionTimer !== null) {
    window.clearInterval(actionTimer);
    actionTimer = null;
  }
}

/*
 * THE STUDENT DID IT.
 *
 * The step is marked done ONCE - `advancing` is set before anything else
 * happens, so a second poll that arrives while the panel is re-rendering cannot
 * advance the tutorial twice. The step is then shown briefly as complete and
 * the tutorial moves on by itself.
 *
 * The LAST step does not advance: it shows its completion state and the Done
 * button, so the student decides when to leave.
 */
function markStepComplete(result = {}) {
  if (advancing || stepState.status === "done") {
    return;
  }

  advancing = true;

  stopActionWatch();

  stepState.status = "done";
  stepState.feedback = null;

  pointer?.classList.add("datum-tutorial-pointer-done");
  ring?.classList.add("datum-tutorial-ring-done");

  renderPanel();

  /* The panel changed height when the success line appeared. */
  placePanel(holeForStep(currentStep));

  announce(`Done. ${currentStep.title} is complete.`);

  void result;

  if (isFinalStep()) {
    /*
     * THE FINAL STEP WAITS FOR DONE, AND SAYS SO. It is not left
     * automatically - the student decides when to go back to the tutorial list -
     * and the button is brought into view and focused so it is found by mouse,
     * by keyboard and by a screen reader alike. Escape is never required.
     */
    advancing = false;

    const done = panel.querySelector("[data-tutorial-done]");

    done?.focus({ preventScroll: true });

    /*
     * BROUGHT INTO VIEW, WHERE THE BROWSER CAN DO IT. jsdom has no layout, so
     * the call is guarded - focusing alone is enough for a screen reader and
     * for a keyboard student in a test DOM.
     */
    if (typeof done?.scrollIntoView === "function") {
      done.scrollIntoView({ block: "nearest", inline: "nearest" });
    }

    announce(
      `Tutorial complete. ${currentStep.title} is done. Press Done to return to the tutorial list.`,
    );

    return;
  }

  advanceTimer = window.setTimeout(() => {
    advanceTimer = null;

    if (!overlay) {
      return;
    }

    stepIndex += 1;

    renderStep();
  }, ADVANCE_DELAY_MS);
}

/*
 * GO BACK A STEP.
 *
 * The step is shown again from the beginning, with its action re-armed against
 * what the drawing looks like NOW - so nothing is carried over from the visit
 * before, and a student who goes back and forward has to do the work again.
 */
function previousStep() {
  if (advancing || stepIndex === 0) {
    return;
  }

  stopActionWatch();

  if (advanceTimer !== null) {
    window.clearTimeout(advanceTimer);
    advanceTimer = null;
  }

  stepIndex -= 1;

  renderStep({ animate: false });
}

/*
 * AN INFORMATIONAL STEP.
 *
 * Nothing to validate, so the student moves on with a single control. It is the
 * ONLY case with a forward button, and it exists because a step that asks
 * nothing cannot be completed by doing something.
 */
function continueInformational() {
  if (advancing || !currentStep || currentStep.action) {
    return;
  }

  /* The final informational step is left with Done, not Continue. */
  if (isFinalStep()) {
    finish();

    return;
  }

  advancing = true;

  stepIndex += 1;

  renderStep();
}

/*
 * ============================================================
 * NAVIGATION AND THE END
 * ============================================================
 */
function finish() {
  const done = handlers.onFinish;

  teardown();

  done?.();
}

function exitTutorial() {
  const exit = handlers.onExit;

  teardown();

  exit?.();
}

/* An accessible announcement; a screen reader cannot see where the ring is. */
function announce(message) {
  if (!liveRegion) {
    return;
  }

  liveRegion.textContent = "";

  requestAnimationFrame(() => {
    if (liveRegion) {
      liveRegion.textContent = message;
    }
  });
}

/*
 * ============================================================
 * THE DEVICE CONTROL
 * ============================================================
 *
 * Both screens build the same control from `guide-device.js`, and both wire it
 * the same way: a change is the student's own choice, so it is respected and
 * never overwritten by detection for the rest of the session.
 */
function bindDeviceSelect(root) {
  const select = root?.querySelector("[data-device-select]");

  if (!select) {
    return;
  }

  select.value = mode();

  select.addEventListener("change", () => {
    import("./guide-device.js")
      .then((device) => {
        device.setMode(select.value, { fromStudent: true });
      })
      .catch(() => {});
  });
}

/*
 * THE MODE CHANGED - from the dropdown, or from a mouse or finger being used
 * while the tutorial runs.
 *
 * The step is NOT restarted: its instruction is re-worded, the pointer is
 * re-drawn in the other shape, and the action watch keeps its baseline - so a
 * student halfway through a drag is not made to begin again.
 */
function onModeChanged() {
  if (!overlay || !currentStep) {
    return;
  }

  renderHeader();
  renderPanel();

  pointer.dataset.mode = mode();
  pointer.innerHTML = pointerMarkup(mode());

  /*
   * THE GUIDE IS REDRAWN, NOT REPLAYED. The student is already looking at the
   * target, so a second journey would be noise; the mark is simply placed and
   * the outline kept.
   */
  const element = findTarget(currentStep.target);

  const hole = holeForStep(currentStep);

  applyScrim(hole);
  applyRing(hole);
  placePanel(hole);

  /*
   * A DEMONSTRATED STEP IS REDRAWN IN THE OTHER DEVICE'S MARK, in place. The
   * endpoints do not move, so the action is not replayed - only its shape and
   * the wording change, which is what the student asked for.
   */
  if (hasDemo(currentStep)) {
    runDemo(currentStep, { animate: false });
  } else {
    guideOnce(hole, { animate: false });
  }

  ring.classList.toggle(
    "datum-tutorial-ring-arrived",
    stepState.status === "done" || Boolean(element),
  );

  announce(`Instructions updated for ${optionFor(mode()).short}.`);
}

/*
 * ============================================================
 * MOUNT / TEARDOWN
 * ============================================================
 */
function mount() {
  overlay = document.createElement("div");
  overlay.className = "datum-tutorial-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "false");
  overlay.setAttribute("aria-label", "Tutorial");

  overlay.innerHTML = `
    <div class="datum-tutorial-scrim" aria-hidden="true">
      <div class="datum-tutorial-scrim-part" data-scrim-top></div>
      <div class="datum-tutorial-scrim-part" data-scrim-bottom></div>
      <div class="datum-tutorial-scrim-part" data-scrim-left></div>
      <div class="datum-tutorial-scrim-part" data-scrim-right></div>
    </div>

    <div class="datum-tutorial-ring" aria-hidden="true"></div>

    <header class="datum-tutorial-header" data-tutorial-header></header>

    <section class="datum-tutorial-panel" data-tutorial-panel
      aria-live="polite" aria-atomic="true"></section>

    <div class="datum-tutorial-pointer" aria-hidden="true"></div>

    <div class="datum-tutorial-live" role="status" aria-live="polite"></div>
  `;

  document.body.appendChild(overlay);

  scrim = overlay.querySelector(".datum-tutorial-scrim");
  ring = overlay.querySelector(".datum-tutorial-ring");
  header = overlay.querySelector("[data-tutorial-header]");
  panel = overlay.querySelector("[data-tutorial-panel]");
  pointer = overlay.querySelector(".datum-tutorial-pointer");
  liveRegion = overlay.querySelector(".datum-tutorial-live");

  /*
   * A LAYOUT CHANGE RE-PLACES THE HIGHLIGHT; IT DOES NOT MOVE THE STUDENT ON.
   *
   * IT ALSO DOES NOTHING WHEN NOTHING MOVED. The `ResizeObserver` on the body
   * fires once the moment the overlay is mounted, and an unconditional redraw
   * there would place the mark at its destination a frame after the journey
   * began - the mark would appear to teleport rather than travel. So the hole
   * is compared with the one last drawn and the redraw is skipped when it is
   * the same rectangle.
   */
  const onLayoutChange = () => {
    if (!currentStep) {
      return;
    }

    const hole = holeForStep(currentStep);

    if (sameHole(hole, lastHole)) {
      return;
    }

    lastHole = hole;

    applyScrim(hole);
    applyRing(hole);
    placePanel(hole);

    /*
     * A DEMONSTRATION IS RE-MEASURED, NOT REPLAYED. Zooming, panning or
     * resizing moves the sheet under the demonstrated path, so the path is
     * recomputed from the live camera and drawn where the gesture ended.
     */
    if (hasDemo(currentStep)) {
      runDemo(currentStep, { animate: false });
    } else {
      guideOnce(hole, { animate: false });
    }
  };

  window.addEventListener("resize", onLayoutChange, { passive: true });
  window.addEventListener("scroll", onLayoutChange, {
    passive: true,
    capture: true,
  });

  if (typeof ResizeObserver === "function") {
    resizeObserver = new ResizeObserver(onLayoutChange);
    resizeObserver.observe(document.body);
  }

  header.addEventListener("click", (event) => {
    if (event.target.closest("[data-tutorial-exit]")) {
      exitTutorial();
    }
  });

  panel.addEventListener("click", (event) => {
    if (event.target.closest("[data-tutorial-continue]")) {
      continueInformational();
    }

    if (event.target.closest("[data-tutorial-done]")) {
      finish();
    }

    if (event.target.closest("[data-tutorial-previous]")) {
      previousStep();
    }
  });

  document.addEventListener("keydown", onKeydown, true);

  handlers.onLayoutChange = onLayoutChange;

  unsubscribeMode = onModeChange(onModeChanged);
}

function onKeydown(event) {
  if (!overlay) {
    return;
  }

  if (event.key === "Escape") {
    /* Esc leaves the tutorial, not the guide: the section is shown again. */
    event.preventDefault();
    event.stopPropagation();

    exitTutorial();

    return;
  }

  /*
   * ENTER ADVANCES AN INFORMATIONAL STEP, which is the only step that has
   * nothing to perform. A step with an action is left by doing it.
   */
  if (
    event.key === "Enter" &&
    currentStep &&
    !currentStep.action &&
    document.activeElement?.closest?.(".datum-tutorial-overlay")
  ) {
    event.preventDefault();
    event.stopPropagation();

    continueInformational();
  }
}

function teardown() {
  stopActionWatch();

  /* Every demonstration frame and marker goes with the overlay. */
  clearDemo();

  /* The next tutorial starts its first journey fresh, not from this one. */
  pointerRun += 1;
  pointerAt = null;
  lastHole = null;

  if (advanceTimer !== null) {
    window.clearTimeout(advanceTimer);
    advanceTimer = null;
  }

  unsubscribeMode?.();
  unsubscribeMode = null;

  if (resizeObserver) {
    resizeObserver.disconnect();
    resizeObserver = null;
  }

  document.removeEventListener("keydown", onKeydown, true);

  if (handlers.onLayoutChange) {
    window.removeEventListener("resize", handlers.onLayoutChange);
    window.removeEventListener("scroll", handlers.onLayoutChange, {
      capture: true,
    });
  }

  if (overlay) {
    overlay.remove();
  }

  overlay = null;
  scrim = null;
  ring = null;
  header = null;
  panel = null;
  pointer = null;
  liveRegion = null;

  currentStep = null;
  tutorial = null;
  stepIndex = 0;

  stepState = { status: "pending", baseline: null, feedback: null };
  advancing = false;

  /* The guide comes back into view and back into reach. */
  document
    .querySelector(".datum-guide-dialog")
    ?.classList.remove("datum-guide-behind-tutorial");
}

/*
 * ============================================================
 * THE PUBLIC DOOR
 * ============================================================
 */
export function createTutorialOverlay(options = {}) {
  handlers = {
    onFinish: options.onFinish || (() => {}),
    onExit: options.onExit || (() => {}),
  };

  return {
    async start(nextTutorial, nextSection) {
      if (overlay) {
        teardown();
      }

      tutorial = nextTutorial;

      /*
       * THE SECTION IS NOT KEPT. The header names the TUTORIAL, which is what
       * the student chose and what the steps are about - the section is only
       * where they found it, and it is still visible in the guide underneath.
       */
      void nextSection;

      stepIndex = 0;

      /*
       * THE GUIDE GIVES THE WORKSPACE BACK WHILE THE TOUR RUNS. A tutorial asks
       * the student to press the real controls, and a modal guide in front of
       * them would make that impossible - so the dialog is held in place but
       * made untouchable, and `teardown` puts it back.
       */
      document
        .querySelector(".datum-guide-dialog")
        ?.classList.add("datum-guide-behind-tutorial");

      mount();
      renderStep();

      announce(
        `${tutorial.title}. ${totalSteps()} steps. Follow the instruction for each one.`,
      );

      if (nextTutorial.prelude?.recipe) {
        await prefill(nextTutorial.prelude);
      }
    },

    stop() {
      teardown();
    },

    isRunning() {
      return Boolean(overlay);
    },

    /* Exposed so a test can drive the flow without guessing at the DOM. */
    state: () => ({
      step: stepIndex + 1,
      total: totalSteps(),
      title: currentStep?.title || "",
      status: stepState.status,
      advancing,
    }),
  };
}

/*
 * GIVE THE TUTORIAL SHEET SOMETHING TO WORK ON.
 *
 * A tutorial about SELECTING a line needs a line, and asking the student to
 * draw one first would double a lesson about selection. The shape is written
 * through the model's own factory, on the tutorial workspace's objects, so it
 * behaves exactly like anything the student draws - and it goes with the
 * scratch sheet when the tutorial ends.
 */
async function prefill(prelude) {
  try {
    const workspace = await import("./guide-workspace.js");

    if (!workspace.isTutorialWorkspaceActive() || workspace.tutorialObjects().length) {
      return;
    }

    const model = await import("../model/drawing-state.js");
    const editor = await import("../../features/workspace/editor-state.js");

    const engine = model.default || model.enggDrawingState;

    const drawing = editor.drawingState || editor.editorState.drawingState;

    const factory = engine.geometryFactories?.[prelude.recipe];

    if (typeof factory !== "function") {
      return;
    }

    const object = factory(
      { x: 80, y: 60 },
      { x: 220, y: 60 },
      { style: { ...drawing.styleDefaults } },
    );

    engine.addObject(drawing, object);

    /* The prefill is not the student's edit, so it joins no history entry. */
    drawing.history.past = [];
    drawing.history.future = [];

    engine.clearInteraction?.(drawing);

    const render = await import(
      "../../components/layout/workspace/canvas-render.js"
    );

    render.renderCurrentDrawing();
  } catch (error) {
    /*
     * A PREFILL THAT FAILS MUST NOT STOP THE TUTORIAL. The steps that need the
     * shape say what to do, and a student can draw it themselves - so the
     * failure is silent rather than a dead tutorial.
     */
  }
}

const enggGuideTutorial = {
  createTutorialOverlay,
};

export default enggGuideTutorial;

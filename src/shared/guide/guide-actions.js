/*
 * ============================================================
 * CHECKING WHETHER THE STUDENT DID WHAT THE STEP ASKED
 * ============================================================
 *
 * A tutorial step says what the student must DO. This module answers the
 * question that follows: did they do it?
 *
 * EVERY CHECK READS THE APPLICATION'S OWN STATE.
 *
 *   a tool was armed         `drawingState.activeTool`
 *   an object was created    `drawingState.objects` on the tutorial sheet
 *   something was selected   `drawingState.selection.selectedObjectIds`
 *   an object moved/resized  the object's geometry, compared with a snapshot
 *   a property changed       the object's stored value, compared with a snapshot
 *   a setting changed        `drawingState.display` / `grid` / `snap`
 *   the source was edited    the sheet's source text
 *   a panel opened           the panel's own state
 *
 * Nothing here listens for a click and assumes. A click that created nothing
 * is a click, not a completed action - and a step that asked for a rectangle
 * is satisfied by a rectangle, not by evidence that the pointer went down.
 *
 * THE CHECKS ALSO REFUSE WORK DONE IN THE WRONG PLACE. Every object check asks
 * the tutorial workspace whether it is in place: an object the student made in
 * their own drawing before opening the guide is not progress in a tutorial, and
 * counting it would let a step complete itself.
 */

import {
  isTutorialWorkspaceActive,
  tutorialObjects,
} from "./guide-workspace.js";

/* The editor state, imported on first use - see the note in guide-workspace. */
let editorStateRef = null;

/* The live drawing, which that module exports separately from the editor state. */
let drawingStateRef = null;

async function state() {
  if (!editorStateRef) {
    const module = await import("../../features/workspace/editor-state.js");

    /*
     * ASKED OF THE MODULE, THEN OF THE GLOBAL. The module publishes the live
     * state both ways - as a named export and as `window.enggEditorState` for
     * the classic code paths - and a harness that loaded it earlier may hold
     * only one of them. Either is the same object.
     */
    const candidate =
      module.editorState ||
      module.default ||
      globalThis.window?.enggEditorState ||
      globalThis.enggEditorState;

    if (!candidate) {
      throw new Error("editor state is not available");
    }

    editorStateRef = candidate;

    /*
     * THE LIVE DRAWING IS ITS OWN EXPORT. It sits beside `editorState` in that
     * module rather than inside it - the UI state and the document are two
     * neighbours, not one container - so it is read from the module and kept
     * alongside the editor state.
     */
    drawingStateRef = module.drawingState || candidate.drawingState || null;
  }

  return drawingStateRef || editorStateRef.drawingState;
}

/* A deep copy, so a "before" snapshot cannot be changed by the edit itself. */
function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

/*
 * ============================================================
 * THE BASELINE
 * ============================================================
 *
 * Most checks need to know what was true WHEN THE STEP OPENED: which objects
 * existed, what a property's value was, which tool was armed. That is taken
 * once, when a step is presented, and called the baseline.
 */
export async function baseline() {
  const drawing = await state();

  installCategoryWatch();

  return {
    activeTool: drawing.activeTool,

    /*
     * HOW MANY TIMES A TOOLSET BUTTON HAS BEEN PRESSED, ever.
     *
     * A toolset step needs this because the toolset it names is often ALREADY
     * showing - the editor opens on Geometry - and "the right toolset is open"
     * would then be satisfied before the student has done anything at all. The
     * press is the lesson, so the press is what is counted.
     */
    categoryPresses,

    zoom: drawing.camera?.zoom ?? 1,

    historyDepth: drawing.history?.past?.length ?? 0,

    phase: drawing.interaction?.phase || "idle",

    objectIds: (drawing.objects || []).map((object) => object.id),

    /** A shallow snapshot of every object, for a from/to comparison. */
    objects: clone(drawing.objects || []),

    selection: [...(drawing.selection?.selectedObjectIds || [])],

    display: clone(drawing.display || {}),
    grid: clone(drawing.grid || {}),
    snap: clone(drawing.snap || {}),

    /* The active sheet's source, as the sheet holds it. */
    source: await currentSourceText(),
  };
}

/*
 * COUNTING TOOLSET PRESSES.
 *
 * One capture-phase listener on the document, installed on first use, so a
 * press is seen wherever it lands - the toolset row is ordinary buttons, and a
 * handler that stops propagation must not hide the student's own choice from
 * the validator. It records and does nothing else: no press is synthesised, no
 * toolset is changed, and nothing is prevented.
 */
let categoryPresses = 0;
let categoryWatchInstalled = false;

function installCategoryWatch() {
  if (categoryWatchInstalled || typeof document === "undefined") {
    return;
  }

  categoryWatchInstalled = true;

  document.addEventListener(
    "click",
    (event) => {
      /*
       * A RECORDING LISTENER MUST NEVER THROW. It runs on every click in the
       * application, and an exception here would take the click's own handler
       * chain down with it - a text node, a shadow root, a window target has no
       * `closest`, so the check is made before it is called.
       */
      const target = event.target;

      if (
        target &&
        typeof target.closest === "function" &&
        target.closest(".drawing-category")
      ) {
        categoryPresses += 1;
      }
    },
    true,
  );
}

/* The source text of the sheet being edited, or "" when there is none. */
async function currentSourceText() {
  try {
    const module =
      await import("../../components/layout/workspace/sheet-controller.js");

    const sheet = module.activeSheet?.();

    if (!sheet?.source) {
      return "";
    }

    return typeof sheet.source === "string"
      ? sheet.source
      : String(sheet.source.draft ?? sheet.source.text ?? "");
  } catch (error) {
    return "";
  }
}

/*
 * ============================================================
 * THE CHECKS
 * ============================================================
 *
 * Each returns one of:
 *
 *   { done: true }                                the action happened
 *   { done: false }                               not yet - keep waiting
 *   { done: false, wrong: "..." }                 an action was taken, but
 *                                                 not the one asked for
 *
 * `wrong` is what produces a helpful correction rather than silence: a student
 * who armed the wrong tool is told which one, instead of being left watching
 * the guide cursor repeat itself with no clue why.
 */

/* --- a tool was armed ------------------------------------------------- */

async function checkTool(expect) {
  const drawing = await state();

  if (drawing.activeTool === expect.tool) {
    return { done: true };
  }

  /*
   * A DIFFERENT TOOL IS NOT NECESSARILY WRONG. The student may still be
   * looking; only a tool they chose and that is clearly not the one asked for
   * is worth correcting, so the hint is gentle and the demonstration continues.
   */
  return {
    done: false,
    hint: expect.hint || null,
  };
}

/* --- a toolset was chosen --------------------------------------------- */

/*
 * THE TOOLSET IS READ FROM THE STRIP, AND THE PRESS IS REQUIRED.
 *
 * Choosing a toolset is not a model change - the category is owned by the
 * toolbar's own row of buttons, not by `drawingState` - so the element that the
 * student pressed is what says which toolset is showing. The press COUNT is
 * what says they pressed it: a step naming the toolset that happens to be open
 * already must still wait for the student, or it would complete itself the
 * instant the tutorial appeared.
 */
async function checkCategory(expect, base) {
  if (!expect.category) {
    return { done: false };
  }

  const pressed = categoryPresses > (base?.categoryPresses ?? 0);

  if (!pressed) {
    return { done: false };
  }

  const active = document.querySelector(".drawing-category.active");

  if (active?.dataset?.category === expect.category) {
    return { done: true };
  }

  return {
    done: false,
    wrong: `Choose ${expect.category} in the toolset row to continue.`,
  };
}

/* --- a group was opened and a tool inside it armed -------------------- */

/*
 * A GROUP IS ONLY A DOOR, SO ITS STEP IS LEFT BY WALKING THROUGH IT.
 *
 * The Statics and Fluids groups (Bodies, Loads, Flow Paths) open a list rather
 * than arming anything, and that list is drawn and then taken away again by the
 * toolbar - so "the group is open" is not a state worth waiting on. What the
 * student was really asked to do is open the group AND pick the tool inside it,
 * and that second half is the one the model can see for certain.
 */
async function checkOpenGroup(expect) {
  const drawing = await state();

  if (drawing.activeTool === expect.tool) {
    return { done: true };
  }

  return { done: false };
}

/* --- an object of a given type was created on the tutorial sheet ---- */

async function checkCreateObject(expect, base) {
  if (!isTutorialWorkspaceActive()) {
    return { done: false };
  }

  const objects = tutorialObjects();

  /*
   * A NULL BASELINE HAS NOTHING CREATED BEFORE IT, so every object on the
   * tutorial sheet counts as new. The sheet starts empty, which makes that the
   * same question as "was one drawn" - see the note in the controller.
   */
  const beforeIds = new Set(base?.objectIds || []);

  const created = objects.filter((object) => !beforeIds.has(object.id));

  const matching = created.filter(
    (object) => !expect.type || object.type === expect.type,
  );

  if (!matching.length) {
    if (created.length) {
      /* Something was drawn - but not the requested kind. */
      return {
        done: false,
        wrong: `That made a ${humanType(created[0].type)}, not a ${humanType(
          expect.type,
        )}. Press Escape, then choose the ${labelOf(expect.type)} tool.`,
      };
    }

    return { done: false };
  }

  /* A shape that satisfies a size rule is checked against the rule. */
  if (expect.minLength) {
    const satisfying = matching.filter(
      (object) => lengthOf(object) >= expect.minLength,
    );

    if (!satisfying.length) {
      return {
        done: false,
        wrong:
          "That is a little too small to count. Drag further to make it bigger.",
      };
    }

    return { done: true, object: satisfying[0] };
  }

  return { done: true, object: matching[0] };
}

/* --- an existing object was selected --------------------------------- */

async function checkSelect(expect) {
  const drawing = await state();

  const selected = drawing.selection?.selectedObjectIds || [];

  if (!selected.length) {
    return { done: false };
  }

  if (expect.type) {
    const matching = drawing.objects.filter(
      (object) => selected.includes(object.id) && object.type === expect.type,
    );

    if (!matching.length) {
      return {
        done: false,
        wrong: `That selected a ${humanType(
          drawing.objects.find((object) => selected.includes(object.id))?.type,
        )}. The step asks for the ${humanType(expect.type)}.`,
      };
    }

    return { done: true, object: matching[0] };
  }

  return { done: true };
}

/*
 * --- an object was moved or resized ------------------------------------
 *
 * "changed" is geometry only, and only the property the step names: a student
 * who nudged the wrong grip has not completed a resize, and a student who
 * changed the colour has not completed a move.
 */
async function checkChangeObject(expect, base) {
  void expect;
  const drawing = await state();

  const target = findTarget(drawing, expect, base);

  if (!target) {
    return { done: false };
  }

  const before = base.objects.find((object) => object.id === target.id);

  if (!before) {
    return { done: false };
  }

  const same =
    JSON.stringify(before.geometry) === JSON.stringify(target.geometry);

  return same ? { done: false } : { done: true, object: target };
}

/* --- a property on the selected feature changed ---------------------- */

async function checkProperty(expect, base) {
  if (!expect.property && !expect.path) {
    return { done: false, hint: "Change the property in the Features tab." };
  }

  const drawing = await state();

  const target = findTarget(drawing, expect, base);

  if (!target) {
    return expect.hint ? { done: false, hint: expect.hint } : { done: false };
  }

  const before = base.objects.find((object) => object.id === target.id);

  const path = expect.path || ["style", expect.property];

  const was = readPath(before, path);
  const now = readPath(target, path);

  if (now === was) {
    return { done: false };
  }

  if (expect.to !== undefined && now !== expect.to) {
    return {
      done: false,
      wrong: `Set it to ${expect.to} to continue.`,
    };
  }

  return { done: true, object: target };
}

/* --- a workspace setting changed ------------------------------------- */

async function checkSetting(expect) {
  const drawing = await state();

  const group = drawing[expect.group] || {};

  if (expect.to === undefined) {
    return { done: false };
  }

  return group[expect.key] === expect.to ? { done: true } : { done: false };
}

/*
 * --- the view was changed --------------------------------------------
 *
 * MEASURED FROM THE CAMERA, NOT FROM THE BUTTON. Zooming with the wheel and
 * clicking + are both "zoomed in"; what makes them the same lesson is that the
 * camera moved in the direction asked for. Fit is its own direction because it
 * is a command rather than a step of zoom.
 */
async function checkZoom(expect, base) {
  const drawing = await state();

  const zoom = drawing.camera?.zoom ?? 1;

  const was = base.zoom ?? 1;

  switch (expect.direction) {
    case "in":
      return zoom > was + 1e-6
        ? { done: true }
        : { done: false, hint: "Click the + button to zoom in." };

    case "out":
      return zoom < was - 1e-6 ? { done: true } : { done: false };

    case "wheel":
      /*
       * THE WHEEL ZOOMS ABOUT THE POINTER, so only the fact that it moved is
       * checked - a student who wheeled out has still learnt where the wheel
       * is, and the next step (Fit) puts the view back.
       */
      return Math.abs(zoom - was) > 1e-6
        ? { done: true }
        : { done: false, hint: "Scroll the wheel over the drawing area." };

    case "fit":
      /*
       * FIT HAS NO STORED FLAG, and inventing one would be a second opinion
       * about the viewport. What can be observed is that the camera was
       * brought back to a whole-sheet view, which is what Fit produces: the
       * zoom changed and no object is left off-screen. The comparison is
       * deliberately loose - this is a lesson about where the button is.
       */
      return Math.abs(zoom - was) > 1e-6 || drawing.camera?.panX === 0
        ? { done: true }
        : { done: false, hint: "Click Fit." };

    default:
      return { done: false };
  }
}

/* --- something was deleted ------------------------------------------- */

async function checkDelete(expect, base) {
  if (!isTutorialWorkspaceActive()) {
    return { done: false };
  }

  const objects = tutorialObjects();

  const beforeIds = new Set(base.objectIds);

  const removed = base.objectIds.filter(
    (id) => !objects.some((object) => object.id === id),
  );

  if (!removed.length) {
    return { done: false };
  }

  if (expect.type) {
    const removedTypes = base.objects
      .filter((object) => removed.includes(object.id))
      .map((object) => object.type);

    if (!removedTypes.includes(expect.type) && beforeIds.size > 1) {
      return {
        done: false,
        wrong: `That removed something else. Select the ${humanType(expect.type)} first, then delete it.`,
      };
    }
  }

  return { done: true };
}

/* --- Undo stepped something back -------------------------------------- */

async function checkUndo(expect, base) {
  const drawing = await state();

  /*
   * THE HISTORY DEPTH IS THE EVIDENCE. A student who pressed Undo with nothing
   * to undo has not learnt a command that did nothing, so the step waits for
   * the past stack to shrink - which only happens when there was an entry.
   */
  const depth = drawing.history?.past?.length ?? 0;

  return depth < (base.historyDepth ?? 0)
    ? { done: true }
    : { done: false };
}

/* --- a multi-step construction was ended ------------------------------ */

async function checkFinish(expect, base) {
  const drawing = await state();

  void expect;

  /*
   * A FINISHED CONSTRUCTION RETURNS THE TOOL TO AN IDLE PHASE. A run still
   * being dragged is not finished, however many legs it has.
   */
  const phase = drawing.interaction?.phase || "idle";

  if (phase !== "idle" && phase !== base.phase) {
    return { done: false };
  }

  return phase === "idle" ? { done: true } : { done: false };
}

/* --- the source changed ---------------------------------------------- */

async function checkSource(expect, base) {
  const now = await currentSourceText();

  if (!base.source && !now) {
    return {
      done: false,
      hint: "Open the Source tab, then edit the drawing's source.",
    };
  }

  if (now === base.source) {
    return { done: false };
  }

  if (expect.contains && !now.includes(expect.contains)) {
    return {
      done: false,
      wrong: `The source changed, but it does not contain “${expect.contains}” yet.`,
      soft: true,
    };
  }

  return { done: true };
}

/* --- a panel or tab was opened --------------------------------------- */

async function checkOpenPanel(expect) {
  const selector =
    {
      objects: '[data-panel-pane="objects"]:not([hidden])',
      features: '[data-panel-pane="features"]:not([hidden])',
      source: '[data-panel-pane="source"]:not([hidden])',
    }[expect.panel] || null;

  if (!selector) {
    return { done: false };
  }

  return document.querySelector(selector) ? { done: true } : { done: false };
}

/*
 * ============================================================
 * DISPATCH
 * ============================================================
 */
export async function check(expect, base) {
  if (!expect || !expect.kind) {
    return { done: true };
  }

  switch (expect.kind) {
    case "tool":
      return checkTool(expect);

    case "category":
      return checkCategory(expect, base);

    case "openGroup":
      return checkOpenGroup(expect);

    case "create":
      return checkCreateObject(expect, base);

    case "select":
      return checkSelect(expect);

    case "change":
      return checkChangeObject(expect, base);

    case "property":
      return checkProperty(expect, base);

    case "setting":
      return checkSetting(expect, base);

    case "zoom":
      return checkZoom(expect, base);

    case "delete":
      return checkDelete(expect, base);

    case "undo":
      return checkUndo(expect, base);

    case "finish":
      return checkFinish(expect, base);

    case "source":
      return checkSource(expect, base);

    case "panel":
      return checkOpenPanel(expect, base);

    default:
      return { done: false };
  }
}

/*
 * ============================================================
 * SMALL READERS
 * ============================================================
 */

function findTarget(drawing, expect, base) {
  const selected = drawing.selection?.selectedObjectIds || [];

  const objects = drawing.objects || [];

  if (expect.id) {
    return objects.find((object) => object.id === expect.id) || null;
  }

  if (expect.type) {
    return (
      objects.find(
        (object) => object.type === expect.type && selected.includes(object.id),
      ) ||
      objects.find((object) => object.type === expect.type) ||
      null
    );
  }

  const anySelected = objects.find((object) => selected.includes(object.id));

  if (anySelected) {
    return anySelected;
  }

  /*
   * THE OBJECT THE STUDENT MADE IN THIS STEP, when nothing is selected - a
   * fresh shape stays selected in this editor, so this is a fallback rather
   * than the usual path.
   */
  const beforeIds = new Set(base.objectIds);

  const created = objects.filter((object) => !beforeIds.has(object.id));

  return created.length ? created[created.length - 1] : null;
}

function readPath(object, path) {
  return path.reduce(
    (value, key) =>
      value === undefined || value === null ? undefined : value[key],
    object,
  );
}

/* The longest extent of a shape, for a "make it big enough" rule. */
function lengthOf(object) {
  const geometry = object?.geometry || {};

  /*
   * A SPAN SHAPE stores two ends. A rectangle stores an origin and its two
   * extents as points - `width` and `height` are vectors from the corner - so
   * each shape family is measured by its own fields rather than by one guess.
   */
  if (geometry.start && geometry.end) {
    return Math.hypot(
      geometry.end.x - geometry.start.x,
      geometry.end.y - geometry.start.y,
    );
  }

  if (geometry.width?.x !== undefined || geometry.height?.y !== undefined) {
    return Math.max(
      Math.abs(geometry.width?.x || 0),
      Math.abs(geometry.height?.y || 0),
    );
  }

  /* A circle's size is its radius, and an arc's is twice that. */
  if (typeof geometry.radius === "number") {
    return geometry.radius * 2;
  }

  return 0;
}

/* A type id as a student would say it. */
function humanType(type) {
  return String(type || "object").replace(/-/g, " ");
}

/* The tool name a type is made by, for a correction's wording. */
function labelOf(type) {
  const names = {
    rectangle: "Rectangle",
    line: "Line",
    circle: "Circle",
    triangle: "Triangle",
    arc: "Arc",
    polygon: "Polygon",
    beam: "Beam",
    force: "Point Load",
    dimension: "Length",
  };

  return names[type] || humanType(type);
}

export default {
  baseline,
  check,
};

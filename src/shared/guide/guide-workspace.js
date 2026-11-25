/*
 * ============================================================
 * THE TUTORIAL WORKSPACE
 * ============================================================
 *
 * A tutorial asks the student to DO things - pick a tool, draw a rectangle,
 * change a property. Those are real interactions with the real editor, so they
 * create real objects. This module is where those objects live: a scratch sheet
 * the student practises on, put in place of their document while the tutorial
 * runs and taken away again afterwards.
 *
 * WHY A SHEET, AND NOT A SECOND CANVAS
 * ------------------------------------
 * The application already has the mechanism for "several drawings, one
 * editor": a document is a COLLECTION of sheets, and the editor holds the live
 * copy of whichever sheet is active. Activating a different sheet is an
 * ordinary thing the student does with the sheet bar - it loads that sheet's
 * objects, its viewport and its settings into the same editor - so a tutorial
 * workspace built on that mechanism gets the real grid, the real rulers, real
 * snapping, real tools, real panels and real rendering for nothing.
 *
 * A second canvas would be a second editor: a mockup wearing the application's
 * clothes. This is the actual editor, showing a different sheet.
 *
 * WHAT IS PRESERVED, AND WHERE
 * ----------------------------
 * The document itself is NEVER touched while the tutorial runs:
 *
 *   - the sheet collection is swapped WHOLE and put back WHOLE, so every sheet,
 *     its objects, its viewport and its settings survive;
 *   - the active sheet id is remembered and restored, so the student comes back
 *     to the sheet they were looking at;
 *   - the camera, the object selection, the pointer hover, the armed tool and
 *     the interaction are captured from the editor and restored to it;
 *   - the undo and redo stacks are set aside and put back, so steps taken in
 *     the tutorial cannot be undone once the student is back in their own
 *     work - and their own history is intact;
 *   - the unsaved-changes flag is remembered and restored, so unsaved work
 *     does not come back looking saved;
 *   - the document's name and file are untouched, and nothing is written to
 *     disk or to the recovery copy.
 *
 * EVERYTHING IS HELD IN MEMORY, IN ONE OBJECT, and `leave()` is the only
 * thing that consumes it. A tutorial that is cancelled, a window that is
 * closed, an error mid-tutorial - the drawing is still in that object, and the
 * restore path is the same one a clean finish takes.
 *
 * IT IS DELIBERATELY NOT A NEW FILE. A real "New document" would clear the
 * unsaved work, close the file, and offer to save on the way out - which is
 * exactly the damage this module exists to prevent. So it is a swap, not a
 * document lifecycle.
 */

let saved = null;

/* Is a tutorial workspace currently in place? */
let active = false;

/*
 * The scratch sheet's own name. Not a sheet name a student would choose, so a
 * glance at the sheet bar makes it obvious where they are.
 */
const TUTORIAL_SHEET_NAME = "Tutorial (temporary)";

/*
 * The live modules, imported on first use.
 *
 * Imported dynamically for the same reason the guide's registry is: this
 * module is reached from a tutorial that may never be started, and pulling the
 * editor state, the sheet controller and the renderer into the boot graph from
 * here would be a cost nobody asked for.
 */
let deps = null;

async function load() {
  if (deps) {
    return deps;
  }

  const [
    editorStateModule,
    sheetsModule,
    controller,
    canvasRender,
    documentCommands,
  ] = await Promise.all([
    import("../../features/workspace/editor-state.js"),
    import("../../components/layout/workspace/sheets.js"),
    import("../../components/layout/workspace/sheet-controller.js"),
    import("../../components/layout/workspace/canvas-render.js"),
    import("../../features/workspace/commands/document-commands.js"),
  ]);

  deps = {
    editorState: editorStateModule.editorState,
    /*
     * `drawingState` IS ITS OWN EXPORT, not a field of `editorState`. The two
     * are declared side by side in that module - the editor's UI state and the
     * live drawing - and reading it off the wrong one is a TypeError that only
     * shows up the first time a tutorial starts.
     */
    drawingState: editorStateModule.drawingState,
    /*
     * `sheets.js` publishes the same object both ways (a named export and a
     * default), but only the NAMED one is guaranteed - the default is there for
     * the older `window.enggSheets` readers.
     */
    sheets: sheetsModule.enggSheets || sheetsModule.default,
    controller,
    renderCurrentDrawing: canvasRender.renderCurrentDrawing,
    documentCommands,
  };

  return deps;
}

/* A deep copy that cannot share a reference with the thing it copied. */
function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

/*
 * ============================================================
 * ENTER
 * ============================================================
 *
 * Capture everything the drawing had, build the scratch sheet, and swap it in.
 *
 * THE CAPTURE HAPPENS BEFORE ANYTHING IS CHANGED. If the swap fails half way -
 * a sheet module that throws, a renderer that cannot draw the scratch sheet -
 * the capture is still complete and `leave()` can still put the student back.
 * So the capture is the first statement, not a step somewhere in the middle.
 */
export async function enter() {
  const live = await load();

  if (active) {
    return true;
  }

  const { editorState, sheets, controller, documentCommands } = live;

  const state = live.drawingState;

  if (!state) {
    throw new Error("The drawing state is not available yet.");
  }

  /*
   * THE DOCUMENT, AS A VALUE.
   *
   * `serializeCollection` is the sheet module's own deep copy, which keeps
   * every sheet's objects, viewport and settings plus the active id - the same
   * statement the file writer and the undo history both use. Nothing here
   * assembles a second version of that shape.
   */
  saved = {
    collection: sheets.serializeCollection(editorState.sheetCollection),
    activeSheetId: editorState.sheetCollection.activeSheetId,

    /* The editor's own live copy: camera, settings, selection, armed tool. */
    camera: clone(state.camera),
    grid: clone(state.grid),
    snap: clone(state.snap),
    objectSnap: clone(state.objectSnap),
    styleDefaults: clone(state.styleDefaults),
    display: clone(state.display),
    units: state.units,
    selection: clone(state.selection),
    activeTool: state.activeTool,
    interaction: clone(state.interaction),

    /* The zoom readout, which the controller keeps beside the camera. */
    drawingZoom: editorState.drawingZoom,

    /* The two stacks, set aside - see the note in `leave()`. */
    history: clone(state.history),

    /* Whether the student had unsaved work, so they still do afterwards. */
    dirty: documentCommands.documentDirtyState?.() ?? false,
  };

  /*
   * THE SCRATCH SHEET.
   *
   * Built through the sheet module's own factory, so it has exactly the shape
   * every other sheet has - units, grid, snapping, style defaults, a viewport
   * and an empty object list - and the editor cannot tell it from a real one.
   * It is the SAME shape a file is loaded into.
   */
  const scratch = sheets.createSheet(
    { sheets: [], activeSheetId: null },
    {
      name: TUTORIAL_SHEET_NAME,
      content: {
        objects: [],
        /*
         * THE SAME VIEWPORT THE STUDENT WAS LOOKING AT, so the scratch sheet
         * opens where the drawing was rather than at an arbitrary origin. The
         * grid and snapping are on because a tutorial is about drawing.
         */
        viewport: {
          zoom: saved.camera.zoom,
          panX: saved.camera.panX,
          panY: saved.camera.panY,
        },
        grid: { visible: true, spacing: 7.5, snapToGrid: true },
        snap: { enabled: true, spacing: 1 },
        objectSnap: { enabled: true },
        styleDefaults: clone(saved.styleDefaults),
        units: saved.units,
      },
    },
  );

  /*
   * A COLLECTION OF ONE. The student's sheets are not in it at all, so no
   * tutorial action can reach one, and no tutorial edit can land on one.
   */
  editorState.sheetCollection = {
    sheets: [scratch],
    activeSheetId: scratch.id,
  };

  controller.loadSheetIntoEditor(scratch);

  /*
   * THE TUTORIAL STARTS FROM A RESTING EDITOR.
   *
   * Whatever tool the student had armed is set aside with the rest of the
   * session - Select is the resting state, and a step that asks for a tool must
   * begin from "no tool chosen" or it would be satisfied by the tool they
   * happened to leave armed in their own drawing. The armed tool is restored on
   * the way out, so this is a swap and not a change to their work.
   */
  state.activeTool = "select";

  if (state.interaction) {
    state.interaction.phase = "idle";
  }

  /* A clean history, so Undo inside the tutorial undoes tutorial work only. */
  state.history.past = [];
  state.history.future = [];

  live.renderCurrentDrawing();

  active = true;

  return true;
}

/*
 * ============================================================
 * LEAVE
 * ============================================================
 *
 * Put the student's drawing back, exactly as it was.
 *
 * THE ORDER IS DELIBERATE:
 *
 *   1. the collection is put back first, so nothing can be read from the
 *      scratch sheet after it has been replaced;
 *   2. the editor adopts the original active sheet, which is what restores its
 *      objects, its viewport and its settings;
 *   3. THEN the captured session state is written over the top - the camera,
 *      the selection, the armed tool - because loading a sheet adjusts some of
 *      those;
 *   4. the history stacks and the dirty flag are restored last, when nothing
 *      else will touch them.
 */
export async function leave() {
  if (!active || !saved) {
    return false;
  }

  const live = await load();

  const {
    editorState,
    sheets,
    controller,
    renderCurrentDrawing,
    documentCommands,
  } = live;

  const state = live.drawingState;

  if (!state) {
    active = false;
    saved = null;

    return false;
  }

  try {
    /* 1 - the document, whole. */
    editorState.sheetCollection = sheets.createCollection(saved.collection);

    editorState.sheetCollection.activeSheetId = saved.activeSheetId;

    /* 2 - the active sheet's content, viewport and settings. */
    const original =
      sheets.sheetById(editorState.sheetCollection, saved.activeSheetId) ||
      sheets.activeSheet(editorState.sheetCollection);

    if (original) {
      controller.loadSheetIntoEditor(original);
    }

    /* 3 - the session, over the top of what the sheet load did. */
    Object.assign(state.camera, saved.camera);

    if (saved.grid) {
      state.grid = { ...saved.grid };
    }

    if (saved.snap) {
      state.snap = { ...saved.snap };
    }

    if (saved.objectSnap) {
      state.objectSnap = { ...saved.objectSnap };
    }

    if (saved.styleDefaults) {
      state.styleDefaults = { ...saved.styleDefaults };
    }

    if (saved.display) {
      state.display = { ...saved.display };
    }

    if (saved.units) {
      state.units = saved.units;
    }

    state.selection = clone(saved.selection);

    state.activeTool = saved.activeTool;

    state.interaction = clone(saved.interaction) || state.interaction;

    editorState.drawingZoom = saved.drawingZoom;

    /*
     * THE ZOOM READOUT GOES BACK WITH THE ZOOM.
     *
     * `loadSheetIntoEditor` wrote the ORIGINAL sheet's zoom into it, which is
     * already right - but the camera was then overwritten above, so the field
     * is written from the same value rather than left to agree by luck.
     */
    const zoomValue = document.getElementById("drawingZoomValue");

    if (zoomValue) {
      zoomValue.value = `${Math.round(state.camera.zoom * 100)}%`;
    }

    /* 4 - the history, and whether the work was unsaved. */
    state.history.past = clone(saved.history?.past) || [];
    state.history.future = clone(saved.history?.future) || [];

    documentCommands.restoreDocumentDirtyState?.(saved.dirty);

    renderCurrentDrawing();

    /*
     * THE SHEET BAR IS REBUILT THROUGH THE CONTROLLER'S OWN REFRESH, which
     * reads the collection it now holds - so the tabs list the student's
     * sheets again, with the one they were on selected.
     */
    controller.activateSheet(saved.activeSheetId);

    return true;
  } finally {
    /*
     * THE CAPTURE IS CONSUMED LAST, AND ONLY AFTER THE RESTORE HAS RUN.
     *
     * A restore that threw half way has still put the collection back (step 1
     * is the one that cannot half-happen), so the student's work is intact
     * even then - and the capture is dropped so a second `leave()` cannot
     * restore an already-restored document over a newer one.
     */
    active = false;
    saved = null;
  }
}

/*
 * WHETHER THE WORKSPACE IS A TUTORIAL ONE RIGHT NOW.
 *
 * The action checks ask this before they trust an object they see: an object
 * created while the tutorial workspace is NOT in place belongs to the student,
 * and must never satisfy a tutorial step.
 */
export function isTutorialWorkspaceActive() {
  return active;
}

/*
 * THE OBJECTS ON THE TUTORIAL SHEET, read from the editor as it stands.
 *
 * A tutorial validates against what the editor actually holds, which is what
 * the student just drew - not against an event that was hoped to mean it.
 */
export function tutorialObjects() {
  if (!active || !deps) {
    return [];
  }

  return (deps.drawingState || deps.editorState.drawingState)?.objects || [];
}

export default {
  enter,
  leave,
  isTutorialWorkspaceActive,
  tutorialObjects,
};

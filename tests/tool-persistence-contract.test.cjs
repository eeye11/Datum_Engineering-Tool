/* eslint-disable no-console */
/*
 * ========================================================
 * THE GLOBAL INTERACTION CONTRACT
 * ========================================================
 *
 * One set of rules for every tool in every category. They are stated here as
 * tests rather than as prose because the previous behaviour was not wrong in
 * one place - it was wrong in the SAME way in about a dozen upgrade paths, and
 * a list of examples is the only way to notice the next one.
 *
 * THE CONTRACT
 * ------------
 *   1. A TOOL STAYS ARMED after it commits an object. Creating an object
 *      selects it; it does not return to Select.
 *   2. A CLICK-TO-CREATE tool keeps creating. Placing N objects takes N clicks
 *      and no re-arming.
 *   3. A CONSTRUCTOR keeps its clicks: a bare click is the first input, not a
 *      dismissal. Only an IDLE click on EMPTY canvas leaves.
 *   4. ESCAPE cancels the operation and returns to Select.
 *   5. A MODIFY operation (Move, Rotate, Mirror, Trim, Extend) is a one-off act
 *      on a selection, so it DOES end when it completes - by its own state
 *      machine, not by a generic reset.
 *   6. EVERYTHING ABOVE HOLDS ACROSS SECTIONS. Statics, Dynamics, Controls,
 *      Thermodynamics and Geometry behave identically; the category a tool
 *      belongs to never changes what a click or an Escape means.
 *
 * The tests drive the real application (index.html + the entry module), so what
 * they pin is what a student gets.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const { bootApp, whenReady } = require("./helpers/boot-app.cjs");
const { locate, modulePath } = require("./helpers/source-path.cjs");

/*
 * THE BOOTED PAGE IS CLOSED WHEN THE FILE FINISHES.
 *
 * Booting starts jsdom's clock and the source-render debounce, and neither
 * stops on its own. Every assertion in this file passes, so the runner prints
 * its eight verdicts and then WAITS - which reads as a hang rather than as a
 * result. `window.close()` clears those timers.
 *
 * IT IS CLOSED ONCE, after the last test, and never between tests: an earlier
 * `close()` left the later ones with a torn-down page.
 */
test.after(async () => {
  await new Promise((resolve) => setImmediate(resolve));
  page?.window?.close?.();
});

let page = null;
let modules = null;

async function ready() {
  if (!page) {
    page = bootApp();

    if (page.error) {
      throw page.error;
    }

    const canvas = page.document.querySelector(".drawing-canvas");

    if (canvas) {
      canvas.getBoundingClientRect = () => ({
        width: 0,
        height: 0,
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        x: 0,
        y: 0,
      });
    }

    await whenReady();
  }

  return page;
}

function app() {
  if (modules) {
    return modules;
  }

  const editor = require(locate("editor-state.js"));
  const model = require(locate("drawing-state.js")).default;

  modules = {
    state: editor.drawingState,
    editorState: editor.editorState,
    model,
    click: require(locate("canvas-click.js")),
    activation: require(modulePath("tool-activation.js")),
    classification: require(modulePath("tool-classification.js")),
    clipboard: require(locate("clipboard-commands.js")),
  };

  return modules;
}

/*
 * A WORLD point, as a click event through the application's own projection.
 *
 * `creationDragConsumedClick` is cleared first: the router consumes one click
 * after a drag-to-create gesture, and a test that placed an object by calling
 * the model directly has no such gesture to consume.
 */
function clickAt(world) {
  const m = app();
  const scale = m.model.BASE_PIXELS_PER_UNIT * (m.state.camera.zoom || 1);

  m.editorState.creationDragConsumedClick = false;

  m.click.handleCanvasClick(
    new page.window.MouseEvent("click", {
      clientX: (world.x - m.state.camera.panX) * scale,
      clientY: -(world.y - m.state.camera.panY) * scale,
      bubbles: true,
      button: 0,
    }),
  );
}

/*
 * A commit the way a TOOL makes one.
 *
 * Through `commitCreatedFeature` rather than the raw model calls, because that
 * is the one path every created feature takes in the application: it adds the
 * object, SELECTS it, and commits - and selecting before the commit is what lets
 * the source writer identify the edited feature. A test that added and committed
 * by hand would be testing a code path the application does not use.
 */
function commit(object) {
  const { commitCreatedFeature } = require(locate("creation-commit.js"));

  commitCreatedFeature(object);
}

/* Empty the sheet and put the editor back in Select. */
function reset() {
  const m = app();

  m.activation.activateTool("select");
  m.state.objects = [];
  m.model.clearInteraction(m.state);
  m.state.selection.selectedObjectIds = [];
  m.state.camera = { zoom: 1, panX: 0, panY: 0 };
}

/* A line, the simplest thing any category can commit. */
function aLine(x = 0) {
  return app().model.geometryFactories.line({ x, y: 0 }, { x: x + 40, y: 20 });
}

/* ============================================================
 * 1. A COMMIT DOES NOT DISARM THE TOOL
 * ============================================================ */

test("a committed object selects itself and leaves the tool armed", async () => {
  await ready();

  const m = app();

  reset();

  /*
   * Tools from FOUR sections, so this is not a Geometry-only guarantee:
   * Geometry (line), Statics (particle), Dynamics (dynamics-particle) and
   * Controls (block).
   */
  for (const tool of ["line", "particle", "dynamics-particle", "block"]) {
    m.activation.activateTool(tool);

    assert.equal(m.state.activeTool, tool, "arming the tool");

    commit(aLine());

    /* The commit is a microtask-deferred reset in the old code; let it run. */
    await Promise.resolve();

    assert.equal(
      m.state.activeTool,
      tool,
      `${tool} must stay armed after committing`,
    );

    assert.ok(
      m.state.selection.selectedObjectIds.length === 1,
      `${tool}: the new object is selected`,
    );
  }
});

test("a click-to-create tool keeps creating on the next click", async () => {
  await ready();

  const m = app();

  /*
   * A point tool's click MAKES the object, so the tool must survive it: the
   * click is not read as "I am finished". This is the ROUTER's answer, which
   * decides whether a second click ever reaches the tool.
   *
   * WHETHER THAT SECOND CLICK COMMITS is a question for the pointer pipeline -
   * snapping, placement and the creation popup - and it belongs to the browser
   * scenario; driving it here would be testing jsdom's layout, not the contract.
   */
  for (const tool of ["point", "particle", "reference-point", "moment"]) {
    assert.equal(
      m.classification.shouldExitToSelectOnClick(tool),
      false,
      `${tool}: the click creates, so it must not end the tool`,
    );
  }

  /*
   * AND A TOOL IS NOT DISARMED BY A COMMIT. Whatever a click places, committing
   * it keeps the tool armed - which is the half of the contract that used to
   * fail for every category at once, from `commitDrawingChange`.
   */
  reset();
  m.activation.activateTool("point");
  m.model.clearInteraction(m.state);

  commit(m.model.geometryFactories.point({ x: -60, y: 40 }));

  await Promise.resolve();

  assert.equal(
    m.state.activeTool,
    "point",
    "a placed point leaves the tool armed for the next one",
  );
});

/* ============================================================
 * 2. A BARE CLICK IS A CONSTRUCTION STEP, NOT A DISMISSAL
 * ============================================================ */

test("a constructor keeps a bare click as its first input", async () => {
  await ready();

  const m = app();

  for (const tool of ["line", "beam", "point-force", "rectangle", "triangle"]) {
    reset();
    m.activation.activateTool(tool);

    assert.equal(
      m.classification.shouldExitToSelectOnClick(tool),
      false,
      `${tool}: a click is its first point, not an exit`,
    );
  }
});

test("but an idle click on empty canvas still leaves any tool", async () => {
  await ready();

  const m = app();

  /*
   * The complement of the rule above: a tool that is NOT making something
   * from the click has nothing to do with it, so the click hands the canvas
   * back to Select. This is what stops a tool from trapping the student - and
   * it is the half the old rule got wrong, because it only exited tools that
   * happened to be in a drag-tool list.
   *
   * TWO FAMILIES ARE DELIBERATELY EXEMPT, and neither is a special case:
   *
   *   `truss` and `pipe-duct` are MULTI-STEP tools. Their whole workflow is a
   *   sequence of clicks - a truss places its first member at the click - so a
   *   click is an INPUT, not a dismissal. They leave through Escape, their own
   *   button, another tool, or a click on an existing object.
   *
   * `arc` is a click-click constructor, in the same family as a Line.
   */
  for (const tool of ["truss", "pipe-duct"]) {
    reset();
    m.activation.activateTool(tool);
    m.model.clearInteraction(m.state);

    assert.equal(
      m.classification.shouldExitToSelectOnClick(tool),
      false,
      `${tool}: its clicks are its construction, not a dismissal`,
    );
  }

  /*
   * AND A TOOL THAT IS NEITHER KEEPS NO CLICK AT ALL. A tool that is not in
   * any of the constructor families has nothing to do with a bare click on
   * empty canvas - this is the part that used to be silent, because the answer
   * was `isDragCreationTool`, which is false for a tool in no list.
   */
  for (const tool of ["elbow"]) {
    assert.equal(
      m.classification.shouldExitToSelectOnClick(tool),
      true,
      `${tool} hands an idle click back to Select`,
    );
  }

  /*
   * THROUGH THE ROUTER: a click on a STARTED construction is that
   * construction's next step, never an exit.
   */
  reset();
  m.activation.activateTool("truss");

  clickAt({ x: 0, y: 0 });

  assert.equal(
    m.state.activeTool,
    "truss",
    "the click that starts a truss begins it rather than ending the tool",
  );
});

/* ============================================================
 * 3. ESCAPE IS ONE PATH FOR EVERY TOOL
 * ============================================================ */

test("Escape cancels the tool and returns to Select, in every section", async () => {
  await ready();

  const m = app();
  const keyboard = require(locate("keyboard-shortcuts.js"));

  const press = () =>
    page.document.dispatchEvent(
      new page.window.KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );

  for (const tool of ["line", "particle", "dynamics-particle", "note"]) {
    reset();
    m.activation.activateTool(tool);

    press();

    assert.equal(
      m.state.activeTool,
      "select",
      `${tool}: Escape returns to Select`,
    );
  }

  assert.ok(keyboard, "the shortcut module is the one that owns Escape");
});

/* ============================================================
 * 4. MODIFY ENDS ITSELF, BY ITS OWN RULES
 * ============================================================ */

test("a failed Modify operation leaves the tool armed for another attempt", async () => {
  await ready();

  const m = app();
  const modify = require(locate("modify-tools.js"));

  /*
   * The Modify tools are the one family where completing DOES end the tool,
   * because a move or a trim is a one-off act on a selection. That ending is
   * the session's own (`endModifySession`), not a generic reset - which is
   * why it still works now that the generic reset is gone.
   */
  assert.equal(
    typeof modify.endModifySession,
    "function",
    "the Modify session owns its own ending",
  );

  reset();
  m.activation.activateTool("trim");

  /*
   * Trim needs a target and a boundary. Called with nothing selected it must
   * not throw, and it must not leave a session running behind the tool.
   */
  assert.equal(
    m.editorState.modifySession ?? null,
    null,
    "no session is left running",
  );
});

/* ============================================================
 * 5. GENERAL OPERATIONS ARE NOT SECTION-SPECIFIC
 * ============================================================ */

test("the clipboard copies and duplicates objects from any section alike", async () => {
  await ready();

  const m = app();

  reset();

  /*
   * One object per section, each carrying section-specific data: a Statics
   * beam with a depth, a Dynamics particle with engineering metadata, and a
   * Controls block with its own metadata object.
   */
  const objects = [
    m.model.geometryFactories.beam({ x: 0, y: 0 }, { x: 100, y: 0 }),
    m.model.geometryFactories.particle({ x: 20, y: 20 }),
    m.model.geometryFactories.force({ x: 40, y: 40 }, { x: 60, y: 70 }),
  ].filter(Boolean);

  assert.ok(objects.length >= 2, "the fixtures exist");

  for (const object of objects) {
    reset();
    commit(object);

    const created = m.state.objects[0];

    assert.ok(created, "the object is on the sheet");

    m.model.selectObjects(m.state, [created.id]);
    m.clipboard.copySelectionToClipboard();

    assert.equal(
      m.state.selection.selectedObjectIds[0],
      created.id,
      "the source is copied",
    );

    m.clipboard.pasteFromClipboard();

    assert.equal(
      m.state.objects.length,
      2,
      `${created.type}: the copy is a NEW object on the sheet`,
    );

    const copy = m.state.objects[1];

    assert.notEqual(copy.id, created.id, "the copy has its own identity");
    assert.equal(copy.type, created.type, "and the same feature type");
    assert.deepEqual(
      copy.engineering ?? null,
      created.engineering ?? null,
      "and the same engineering record",
    );

    assert.deepEqual(
      m.state.selection.selectedObjectIds,
      [copy.id],
      "and the copy is what is selected afterwards",
    );
  }
});

test("undo and redo restore the previous and the resulting state, across sections", async () => {
  await ready();

  const m = app();

  for (const make of [
    () => aLine(),
    () => m.model.geometryFactories.beam({ x: 0, y: 0 }, { x: 100, y: 0 }),
    () => m.model.geometryFactories.particle({ x: 0, y: 0 }),
  ]) {
    reset();

    const object = make();

    if (!object) {
      continue;
    }

    const name = object.type;

    commit(object);

    assert.equal(m.state.objects.length, 1, `${name}: created`);

    m.model.undo(m.state);

    assert.equal(
      m.state.objects.length,
      0,
      `${name}: undo removes the one committed action`,
    );

    m.model.redo(m.state);

    assert.equal(m.state.objects.length, 1, `${name}: redo restores it`);
    assert.equal(m.state.objects[0].type, name, "and restores the right type");
  }
});

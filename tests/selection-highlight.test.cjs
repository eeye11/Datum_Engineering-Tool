/* eslint-disable no-console */
/*
 * ========================================================
 * SELECTION HIGHLIGHTING AND CLICK-OUTSIDE BEHAVIOUR
 * ========================================================
 *
 * Three rules, shared by every drawing tool rather than written per category:
 *
 *   1. the highlight box measures ONLY the selected objects;
 *   2. clicking an existing object switches to Select and selects it;
 *   3. clicking empty canvas clears the selection and returns to Select.
 *
 * Rule 3 is the one that has to be careful: it must not interrupt a drawing
 * gesture. A press-drag-release never reaches the click router at all, and a
 * click-click shape's first corner is a real step of its workflow.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const { bootApp, whenReady } = require("./helpers/boot-app.cjs");

test.after(() => {
  setImmediate(() => process.exit(process.exitCode || 0));
});

let page = null;

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
        y: 0
      });
    }

    await whenReady();
  }

  return page;
}

const locate = (name) => require("./helpers/source-path.cjs").locate(name);

function modules() {
  return {
    state: require(locate("editor-state.js")).drawingState,
    editorState: require(locate("editor-state.js")).editorState,
    click: require(locate("canvas-click.js")),
    ds: require(locate("drawing-state.js")).default,
    bounds: require(locate("selection-transform.js")).selectionBounds,
    pipe: require(locate("model/fluids/pipe-duct.js")).default
  };
}

/* A click on the canvas at a WORLD point, through the app's own projection. */
function clickAt(page, world) {
  const m = modules();
  const scale = m.ds.BASE_PIXELS_PER_UNIT * (m.state.camera.zoom || 1);

  m.editorState.creationDragConsumedClick = false;

  m.click.handleCanvasClick(
    new page.window.MouseEvent("click", {
      clientX: (world.x - m.state.camera.panX) * scale,
      clientY: -(world.y - m.state.camera.panY) * scale,
      bubbles: true,
      button: 0
    })
  );
}

function sheet() {
  const m = modules();

  const first = m.ds.createGeometryObject(
    "line",
    { start: { x: 100, y: 100 }, end: { x: 400, y: 100 } },
    {}
  );

  const second = m.ds.createGeometryObject(
    "line",
    { start: { x: 100, y: 300 }, end: { x: 400, y: 300 } },
    {}
  );

  m.state.objects = [first, second];
  m.state.selection.selectedObjectIds = [];
  m.ds.setActiveTool(m.state, "select");
  m.ds.clearInteraction(m.state);

  return { m, first, second };
}

/* ============================================================
 * 1. THE HIGHLIGHT BOX MEASURES ONLY WHAT IS SELECTED
 * ============================================================ */

test("the highlight box covers the selected object only", async () => {
  await ready();

  const { m, first } = sheet();

  const box = m.bounds(m.state.objects, [first.id]);

  assert.equal(box.minY, 100);
  assert.equal(box.maxY, 100);
  assert.equal(
    box.maxY < 300,
    true,
    "the unselected line must not stretch the box"
  );
});

test("a multi-selection box encompasses the selected items only", async () => {
  await ready();

  const { m, first, second } = sheet();

  const both = m.bounds(m.state.objects, [first.id, second.id]);

  assert.equal(both.minY, 100);
  assert.equal(both.maxY, 300);
});

test("a pipe's box encloses both walls, not just its centreline", async () => {
  await ready();

  const m = modules();
  const run = m.pipe.createPipeDuct({ x: 0, y: 0 }, { x: 100, y: 0 });

  run.id = "pipe-box";

  const box = m.bounds([run], [run.id]);
  const separation = m.pipe.DEFAULT_SCHEMATIC_SEPARATION;

  assert.ok(box.maxY - box.minY >= separation - 1e-9, "a flat line is not a box around a pipe");
  assert.equal(box.minY, -separation / 2);
  assert.equal(box.maxY, separation / 2);
});

/* ============================================================
 * 2. CLICKING AN EXISTING OBJECT SELECTS IT
 * ============================================================ */

test("clicking an object with Select selects it", async () => {
  const page = await ready();
  const { m, first } = sheet();

  clickAt(page, { x: 250, y: 100 });

  assert.deepEqual([...m.state.selection.selectedObjectIds], [first.id]);
  assert.equal(m.state.activeTool, "select");
});

test("clicking an unselected object with another tool switches to Select", async () => {
  const page = await ready();
  const { m, second } = sheet();

  m.ds.setActiveTool(m.state, "rectangle");
  m.ds.clearInteraction(m.state);

  clickAt(page, { x: 250, y: 300 });

  assert.equal(m.state.activeTool, "select", "the click must return to Select");
  assert.deepEqual([...m.state.selection.selectedObjectIds], [second.id]);
});

test("shift-click extends the selection", async () => {
  const page = await ready();
  const { m, first, second } = sheet();

  m.state.selection.selectedObjectIds = [first.id];

  const scale = m.ds.BASE_PIXELS_PER_UNIT * (m.state.camera.zoom || 1);

  m.editorState.creationDragConsumedClick = false;

  m.click.handleCanvasClick(
    new page.window.MouseEvent("click", {
      clientX: (250 - m.state.camera.panX) * scale,
      clientY: -(300 - m.state.camera.panY) * scale,
      bubbles: true,
      button: 0,
      shiftKey: true
    })
  );

  assert.equal(m.state.selection.selectedObjectIds.length, 2);
  assert.ok(m.state.selection.selectedObjectIds.includes(second.id));
});

/* ============================================================
 * 3. CLICKING EMPTY CANVAS CLEARS AND RETURNS TO SELECT
 * ============================================================ */

test("clicking empty canvas with Select clears the selection", async () => {
  const page = await ready();
  const { m, first } = sheet();

  m.state.selection.selectedObjectIds = [first.id];

  clickAt(page, { x: 10, y: 10 });

  assert.equal(m.state.selection.selectedObjectIds.length, 0);
  assert.equal(m.state.activeTool, "select");
});

test("clicking empty canvas clears a multi-selection", async () => {
  const page = await ready();
  const { m, first, second } = sheet();

  m.state.selection.selectedObjectIds = [first.id, second.id];

  clickAt(page, { x: 10, y: 10 });

  assert.equal(m.state.selection.selectedObjectIds.length, 0);
});

test("clicking empty canvas with an annotation tool returns to Select", async () => {
  const page = await ready();
  const { m, first } = sheet();

  m.state.selection.selectedObjectIds = [first.id];
  m.ds.setActiveTool(m.state, "annotate");
  m.ds.clearInteraction(m.state);

  clickAt(page, { x: 10, y: 10 });

  assert.equal(m.state.activeTool, "select");
  assert.equal(m.state.selection.selectedObjectIds.length, 0);
});

test("clicking empty canvas with an idle construction tool returns to Select", async () => {
  const page = await ready();
  const { m } = sheet();

  /* A construction tool with no shape started and nothing under the pointer. */
  m.ds.setActiveTool(m.state, "truss");
  m.ds.clearInteraction(m.state);

  clickAt(page, { x: 10, y: 10 });

  assert.equal(m.state.activeTool, "select");
});

/* ============================================================
 * 4. DRAWING IS NOT INTERRUPTED
 * ============================================================ */

test("a click-click shape still takes its two corners", async () => {
  const page = await ready();
  const m = modules();

  m.state.objects = [];
  m.state.selection.selectedObjectIds = [];
  m.ds.setActiveTool(m.state, "line");
  m.ds.clearInteraction(m.state);

  clickAt(page, { x: 0, y: 0 });

  assert.equal(m.state.activeTool, "line", "the first corner must not exit the tool");
  assert.equal(m.state.interaction.phase, "first-point");

  clickAt(page, { x: 100, y: 100 });

  assert.equal(m.state.objects.length, 1, "the second click must complete the line");
  assert.equal(m.state.objects[0].type, "line");
});

test("a pipe / duct run's first corner does not exit the tool", async () => {
  const page = await ready();
  const m = modules();

  m.state.objects = [];
  m.state.selection.selectedObjectIds = [];
  m.ds.setActiveTool(m.state, "pipe-duct");
  m.ds.clearInteraction(m.state);

  clickAt(page, { x: 0, y: 0 });

  assert.equal(m.state.activeTool, "pipe-duct");
});

/*
 * ========================================================
 * THE JUNCTION TOOL IS REACHABLE, AND ITS GESTURE CREATES
 * ========================================================
 *
 * The tool is armed by the toolbar and drawn by press-drag-release. Every one
 * of those three links is asserted here, because a junction that is armed but
 * cannot be pressed creates NOTHING and looks like "the tool does not work".
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const { bootApp } = require("./helpers/boot-app.cjs");
const { locate } = require("./helpers/source-path.cjs");

test.after(() => {
  setImmediate(() => process.exit(process.exitCode || 0));
});

let page = null;

function ready() {
  if (!page) {
    page = bootApp();

    if (page.error) {
      throw page.error;
    }
  }

  return page;
}

const CANVAS = { left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0 };

function modules() {
  ready();

  const dom = require(locate("interaction/dom.js"));

  dom.drawingCanvas.getBoundingClientRect = () => CANVAS;
  Object.defineProperty(dom.drawingCanvas, "clientWidth", { value: CANVAS.width, configurable: true });
  Object.defineProperty(dom.drawingCanvas, "clientHeight", { value: CANVAS.height, configurable: true });
  dom.drawingCanvas.setPointerCapture = () => {};
  dom.drawingCanvas.releasePointerCapture = () => {};
  dom.drawingCanvas.hasPointerCapture = () => false;

  const editor = require(locate("editor-state.js"));

  editor.drawingState.objects = [];
  editor.drawingState.selection.selectedObjectIds = [];
  editor.drawingState.camera.zoom = 1;
  editor.drawingState.camera.panX = 0;
  editor.drawingState.camera.panY = 0;
  editor.editorState.creationDrag = null;

  return {
    state: editor.drawingState,
    editorState: editor.editorState,
    activation: require(locate("tool-activation.js")),
    creation: require(locate("creation-drag.js")),
    handles: require(locate("handles.js")),
    schema: require(locate("feature-schema.js")),
    dom
  };
}

const pointer = (type, point) => {
  const event = new window.MouseEvent(type, {
    clientX: CANVAS.left + CANVAS.width / 2 + point.x,
    clientY: CANVAS.top + CANVAS.height / 2 - point.y,
    bubbles: true,
    button: 0
  });

  event.pointerId = 1;
  event.pointerType = "mouse";

  return event;
};

test("the Junction tool is a drag-creation tool", () => {
  const m = modules();

  assert.equal(
    m.creation.isDragCreationTool("junction"),
    true,
    "a press must be claimed by the junction tool, or it is armed but inert"
  );

  /* The two tools it sits beside are still drag tools. */
  assert.equal(m.creation.isDragCreationTool("pipe-duct"), true);
  assert.equal(m.creation.isDragCreationTool("elbow"), true);
});

test("activating the Junction tool arms it", () => {
  const m = modules();

  m.activation.activateTool("junction");

  assert.equal(m.state.activeTool, "junction", "the tool is the active tool");
  assert.equal(m.state.interaction.fluidsTool, "junction", "the Fluids panel knows which tool is armed");
});

test("press-drag-release on the canvas creates one Junction", () => {
  const m = modules();

  m.activation.activateTool("junction");

  assert.equal(
    m.creation.beginCreationDrag(pointer("pointerdown", { x: 100, y: 100 })),
    true,
    "the press begins the junction's session"
  );

  assert.ok(m.editorState.creationDrag?.junction, "and the session is a junction session");

  m.creation.moveCreationDrag(pointer("pointermove", { x: 220, y: 100 }));

  assert.ok(m.state.interaction.preview, "a live preview is published while dragging");

  m.creation.finishCreationDrag(pointer("pointerup", { x: 220, y: 100 }));

  const junctions = m.state.objects.filter((object) => object.type === "junction");

  assert.equal(junctions.length, 1, "exactly one junction was created");

  const junction = junctions[0];

  assert.ok(junction.geometry.branches.length >= 3, "it has three or more branches");
  assert.ok(junction.geometry.position, "it has a hub");

  /* The drag set the MAIN RUN, and its DISTANCE was not turned into a length. */
  assert.ok(
    Math.abs(junction.geometry.mainDirection.x - 1) < 1e-6,
    "the horizontal drag set the main-run direction"
  );

  assert.equal(junction.engineering.branchLength, undefined, "no branch length was stored");
});

test("an armed Junction that cannot be pressed leaves the tool looking broken - guarded", () => {
  const m = modules();

  m.activation.activateTool("junction");

  /* A second press mid-session is refused rather than starting a second. */
  m.creation.beginCreationDrag(pointer("pointerdown", { x: 60, y: 60 }));

  assert.equal(
    m.creation.beginCreationDrag(pointer("pointerdown", { x: 70, y: 70 })),
    false,
    "one gesture at a time"
  );
});

test("a placed Junction is selectable and offers branch handles", () => {
  const m = modules();

  m.activation.activateTool("junction");
  m.creation.beginCreationDrag(pointer("pointerdown", { x: 0, y: 0 }));
  m.creation.moveCreationDrag(pointer("pointermove", { x: 100, y: 0 }));
  m.creation.finishCreationDrag(pointer("pointerup", { x: 100, y: 0 }));

  const junction = m.state.objects.find((object) => object.type === "junction");

  assert.ok(junction, "the junction exists");

  const kinds = m.handles.editableHandlesFor(junction).map((handle) => handle.kind);

  assert.ok(kinds.includes("position"), "the hub has a handle");
  assert.ok(
    kinds.some((kind) => kind.startsWith("junction-branch-") || kind === "junction-main"),
    "the branches have handles"
  );
  assert.ok(!kinds.includes("rotate"), "and there is no rotation handle");

  /* The panel shows Object, Appearance and Transform - no angle rows. */
  const keys = m.schema
    .groupsFor(junction)
    .flatMap((group) => group.fields.map((field) => field.key));

  assert.ok(!keys.some((key) => /angle/i.test(key)), "no angle control in the panel");
});

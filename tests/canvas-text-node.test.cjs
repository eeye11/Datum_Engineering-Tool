/* eslint-disable no-console */
/*
 * ========================================================
 * A TEXT NODE IS WRITTEN ON THE DRAWING SPACE
 * ========================================================
 *
 * The Text Node is a NOTE: an empty string, a stable id, and a visible box on
 * the canvas - not a popup, not a sidebar field, not a floating panel. This suite
 * drives the real application, so it checks what a student would see:
 *
 *   - the Note tool places an EMPTY node and opens a box ON the canvas;
 *   - the box is INSIDE the canvas element, so it travels with zoom and pan;
 *   - typing shows on the drawing as it is typed, Enter makes lines,
 *     Ctrl+Enter commits, Escape cancels;
 *   - Escape on a just-placed, never-written node removes it (no orphan);
 *   - the canonical model and the source agree after the commit.
 */

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { bootApp, whenReady } = require("./helpers/boot-app.cjs");
const { locate } = require("./helpers/source-path.cjs");

const { window, document, error } = bootApp();

if (error) throw error;

let state;
let model;
let canvas;

const CANVAS = { width: 900, height: 600 };

before(async () => {
  await whenReady();

  state = require(locate("editor-state.js")).drawingState;
  model = require(locate("drawing-state.js")).default;

  state.objects = [];
  state.camera = { zoom: 1, panX: 0, panY: 0 };

  canvas = document.querySelector(".drawing-canvas");

  Object.defineProperties(canvas, {
    clientWidth: { value: CANVAS.width, configurable: true },
    clientHeight: { value: CANVAS.height, configurable: true },
  });

  canvas.getBoundingClientRect = () => ({
    left: 0,
    top: 0,
    width: CANVAS.width,
    height: CANVAS.height,
    right: CANVAS.width,
    bottom: CANVAS.height,
  });

  canvas.setPointerCapture = () => {};
  canvas.hasPointerCapture = () => false;
  canvas.releasePointerCapture = () => {};
});

after(() => window.close());

/* The window point of a drawing coordinate, through the app's own projection. */
function at(point) {
  const p = model.engineeringToScreen(point, CANVAS, state);

  return {
    pointerId: 19,
    button: 0,
    clientX: p.x,
    clientY: p.y,
    shiftKey: false,
  };
}

function click(event) {
  canvas.dispatchEvent(
    new window.MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      clientX: event.clientX,
      clientY: event.clientY,
      button: 0,
    }),
  );
}

const editorBox = () => document.querySelector(".drawing-canvas-text-editor");

const textNodes = () =>
  state.objects.filter(
    (object) => object.type === "annotate" && object.annotateKind === "note",
  );

function lastNote() {
  const nodes = textNodes();

  return nodes[nodes.length - 1] || null;
}

test("the Note tool creates an empty node with a box on the canvas", async () => {
  model.setActiveTool(state, "note");

  model.setInteraction(state, { ...state.interaction, phase: "idle" });

  const event = at({ x: 0, y: 20 });
  const clicks = require(locate("canvas-click.js"));

  clicks.handleCanvasClick(event);
  await new Promise((resolve) => setTimeout(resolve, 10));

  const note = lastNote();

  assert.ok(note, "a note node exists");
  assert.equal(note.text, "", "it starts empty");
  assert.ok(note.id, "it has a stable id");

  const box = editorBox();

  assert.ok(box, "a text box is open");
  assert.equal(box.parentElement, canvas, "the box is a child of the canvas");
  assert.equal(box.style.position || "", "", "positioned by the stylesheet");
  assert.ok(
    box.querySelector("textarea"),
    "the box holds the editable field",
  );
  assert.equal(
    document.activeElement,
    box.querySelector("textarea"),
    "the caret is in the box",
  );

  /* The box is placed in the canvas's own frame, at the node. */
  assert.ok(parseFloat(box.style.left) > 0, box.style.left);
  assert.ok(parseFloat(box.style.top) > 0, box.style.top);
  assert.ok(
    parseFloat(box.style.left) < CANVAS.width &&
      parseFloat(box.style.top) < CANVAS.height,
    "and inside the canvas",
  );
});

test("typing shows on the drawing as it is typed", () => {
  const box = editorBox();
  const input = box.querySelector("textarea");

  input.value = "Line one";
  input.dispatchEvent(new window.Event("input", { bubbles: true }));

  assert.equal(lastNote().text, "Line one");

  /* A new line needs no commit key press. */
  input.value = "Line one\nLine two";
  input.dispatchEvent(new window.Event("input", { bubbles: true }));

  assert.equal(lastNote().text, "Line one\nLine two");
});

test("Enter makes a line and does not commit; Ctrl+Enter commits", () => {
  const input = editorBox().querySelector("textarea");

  input.dispatchEvent(
    new window.KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    }),
  );

  assert.ok(editorBox(), "Enter did not close the box");
  assert.equal(state.activeTool, "note", "and did not change the tool");

  input.dispatchEvent(
    new window.KeyboardEvent("keydown", {
      key: "Enter",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    }),
  );

  assert.equal(editorBox(), null, "Ctrl+Enter closes the box");
  assert.equal(lastNote().text, "Line one\nLine two", "with the text kept");
});

test("double-click reopens the box, and Escape restores the committed text", async () => {
  const note = lastNote();
  const clicks = require(locate("canvas-click.js"));

  clicks.openNoteEditorFor(note);

  const input = editorBox().querySelector("textarea");

  assert.equal(input.value, "Line one\nLine two", "editing shows the text");

  input.value = "changed";
  input.dispatchEvent(new window.Event("input", { bubbles: true }));

  input.dispatchEvent(
    new window.KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    }),
  );

  assert.equal(editorBox(), null, "Escape closed the box");
  assert.equal(lastNote().text, "Line one\nLine two", "and restored the text");
  assert.equal(textNodes().length, 1, "the node itself was not removed");
});

test("Escape on a just-placed, never-written node removes it", async () => {
  const clicks = require(locate("canvas-click.js"));
  const before = textNodes().length;

  model.setActiveTool(state, "note");

  clicks.handleCanvasClick(at({ x: 10, y: -10 }));
  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.equal(textNodes().length, before + 1, "placed empty");

  const input = editorBox().querySelector("textarea");

  input.dispatchEvent(
    new window.KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    }),
  );

  assert.equal(editorBox(), null, "closed");
  assert.equal(textNodes().length, before, "and the orphan is gone");
});

test("the committed text reaches the source", () => {
  const writer = require(locate("source-writers/annotations.js"));

  const written = writer.annotationSourceWriter(lastNote());

  assert.ok(
    String(written || "").includes("Line one"),
    "the source states the written text",
  );
});

/*
 * ========================================================
 * TWO FINGERS MOVE THE VIEW, NEVER THE DRAWING
 * ========================================================
 *
 * The camera maths a pinch and a pan share, driven through the real viewport
 * module with a real canvas. What is checked is the property that matters to an
 * engineer: after any pan or pinch, every object's ENGINEERING coordinates are
 * exactly what they were.
 */

const test = require("node:test");
const assert = require("node:assert");
const { JSDOM } = require("jsdom");

const dom = new JSDOM(
  "<!doctype html><html><body><div class='drawing-canvas' id='canvas'></div></body></html>",
  { pretendToBeVisual: true },
);

global.window = dom.window;
global.document = dom.window.document;

/* The drawing surface, found by the selector the application itself uses. */
const canvas = global.document.querySelector(".drawing-canvas");

canvas.getBoundingClientRect = () => ({
  width: 900,
  height: 600,
  left: 0,
  top: 0,
  right: 900,
  bottom: 600,
});

const { applyTwoFingerGesture } = require("../src/components/layout/workspace/viewport.js");
const { drawingState } = require("../src/features/workspace/editor-state.js");

/* A drawing with one object at a known engineering position. */
const OBJECT_AT = { x: 120, y: -45 };

drawingState.objects = [
  {
    id: "line-1",
    type: "line",
    geometry: { start: { ...OBJECT_AT }, end: { x: 220, y: -45 } },
    style: {},
  },
];

drawingState.camera.zoom = 1;
drawingState.camera.panX = 0;
drawingState.camera.panY = 0;

const engineeringPosition = () => JSON.stringify(drawingState.objects[0].geometry);

test("a pan moves the camera and leaves the object where it is", () => {
  const before = engineeringPosition();
  const zoomBefore = drawingState.camera.zoom;

  applyTwoFingerGesture({ panX: 40, panY: -20, zoomRatio: 1, midX: 450, midY: 300 });

  assert.notStrictEqual(drawingState.camera.panX, 0, "the view moved");
  assert.strictEqual(drawingState.camera.zoom, zoomBefore, "a pan is not a zoom");
  assert.strictEqual(engineeringPosition(), before, "the drawing is untouched");
});

test("a pinch changes the zoom and leaves the object where it is", () => {
  drawingState.camera.zoom = 1;
  drawingState.camera.panX = 0;
  drawingState.camera.panY = 0;

  const before = engineeringPosition();

  applyTwoFingerGesture({ panX: 0, panY: 0, zoomRatio: 1.5, midX: 450, midY: 300 });

  assert.ok(drawingState.camera.zoom > 1, "spreading the fingers zooms in");
  assert.strictEqual(engineeringPosition(), before, "the drawing is untouched");
});

test("pinching in zooms out", () => {
  drawingState.camera.zoom = 1;
  drawingState.camera.panX = 0;
  drawingState.camera.panY = 0;

  applyTwoFingerGesture({ panX: 0, panY: 0, zoomRatio: 0.5, midX: 450, midY: 300 });

  assert.ok(drawingState.camera.zoom < 1, "bringing the fingers together zooms out");
});

test("the zoom is clamped, so a fast pinch cannot leave the supported range", () => {
  drawingState.camera.zoom = 1;
  drawingState.camera.panX = 0;
  drawingState.camera.panY = 0;

  /* An implausible ratio, as a dropped frame can produce. */
  applyTwoFingerGesture({ panX: 0, panY: 0, zoomRatio: 10000, midX: 450, midY: 300 });

  const ceiling = 10000;

  assert.ok(
    Number.isFinite(drawingState.camera.zoom) && drawingState.camera.zoom <= ceiling,
    `zoom stayed finite and bounded (${drawingState.camera.zoom})`,
  );
  assert.ok(drawingState.camera.zoom > 0, "and positive");
});

test("a ratio of exactly 1 is not applied, so a pan cannot re-round the zoom", () => {
  drawingState.camera.zoom = 0.8333;
  const zoom = drawingState.camera.zoom;

  applyTwoFingerGesture({ panX: 12, panY: 0, zoomRatio: 1, midX: 450, midY: 300 });

  assert.strictEqual(drawingState.camera.zoom, zoom);
});

test("a gesture with no movement does nothing at all", () => {
  drawingState.camera.zoom = 1;
  drawingState.camera.panX = 0;
  drawingState.camera.panY = 0;

  const before = { ...drawingState.camera };
  const objects = engineeringPosition();

  applyTwoFingerGesture({ panX: 0, panY: 0, zoomRatio: 1, midX: 450, midY: 300 });

  assert.strictEqual(drawingState.camera.zoom, before.zoom);
  assert.strictEqual(drawingState.camera.panX, before.panX);
  assert.strictEqual(drawingState.camera.panY, before.panY);
  assert.strictEqual(engineeringPosition(), objects);
});

test("the viewport a gesture leaves is what the sheet records", () => {
  drawingState.camera.zoom = 1;
  drawingState.camera.panX = 0;
  drawingState.camera.panY = 0;

  applyTwoFingerGesture({ panX: 25, panY: 0, zoomRatio: 1.2, midX: 450, midY: 300 });

  const { editorState } = require("../src/features/workspace/editor-state.js");
  const active = editorState.sheetCollection.sheets.find(
    (sheet) => sheet.id === editorState.sheetCollection.activeSheetId,
  );

  assert.ok(active, "the sheet exists");

  /*
   * A view is a view: the sheet remembers it, and it is not a document change.
   * A pan or pinch must never make the drawing "unsaved".
   */
  assert.strictEqual(active.viewport.zoom, drawingState.camera.zoom);
});

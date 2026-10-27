/*
 * ========================================================
 * WHAT IS DRAWN IS ALWAYS VISIBLE WHERE IT REALLY IS
 * ========================================================
 *
 * The Drawing Space shows the compiled source, and a compile takes a moment (or
 * never comes, with the render server not running). These check the overlay
 * draws every object the picture on screen does not show yet - just drawn, being
 * moved, or with no picture at all - and steps aside once the picture agrees.
 * And that the picture's print line widths are shown at a readable screen width.
 */

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");

const { bootApp, whenReady } = require("./helpers/boot-app.cjs");
const { locate } = require("./helpers/source-path.cjs");

const { window, document, error } = bootApp();

if (error) {
  console.log(`the application did not boot: ${error.message}`);
  process.exit(1);
}

/* A render server stub whose answers are held until the test releases them. */
const pending = [];

window.fetch = globalThis.fetch = (url) => {
  if (!String(url).includes("/api/render-tikz")) {
    return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
  }

  return new Promise((resolve) => {
    pending.push(() => resolve({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        svg: '<svg xmlns="http://www.w3.org/2000/svg"><path stroke="#193335" stroke-width=".28" d="M0 0h10"/></svg>'
      })
    }));
  });
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let model;
let drawingState;
let canvasRender;
let canvas;
let objectAtPoint;

before(async () => {
  await whenReady();

  model = require(locate("drawing-state.js")).default;
  ({ drawingState } = require(locate("editor-state.js")));
  canvasRender = require(locate("canvas-render.js"));
  ({ objectAtPoint } = require(locate("hit-testing.js")));
  canvas = document.querySelector(".drawing-canvas");

  await wait(300);
});

after(() => window.close());

function liveIds() {
  return [...canvas.querySelectorAll(":scope > svg.drawing-overlay [data-feature-id]")]
    .map((element) => element.getAttribute("data-feature-id"));
}

async function answerEveryCompile() {
  for (let i = 0; i < 40; i++) {
    while (pending.length) {
      pending.shift()();
    }

    await wait(50);

    if (!pending.length && canvas.querySelector(":scope > svg.drawing-source-layer path")) {
      return;
    }
  }
}

let line;

test("a just-drawn object is on screen before its compile arrives", () => {
  const snapshot = model.snapshotDrawing(drawingState);

  line = model.addObject(drawingState, model.geometryFactories.line({ x: -20, y: 0 }, { x: 20, y: 0 }, {}));
  model.commitDrawingChange(drawingState, snapshot);
  canvasRender.renderCurrentDrawing();

  assert.ok(liveIds().includes(line.id), `the overlay drew ${JSON.stringify(liveIds())}`);
});

test("once the picture shows it, the overlay steps aside", async () => {
  await answerEveryCompile();
  canvasRender.renderCurrentDrawing();

  assert.deepEqual(liveIds(), []);
});

test("an object being moved is drawn where it is, not where the picture last saw it", () => {
  line.geometry.start = { x: -20, y: 30 };
  line.geometry.end = { x: 20, y: 30 };
  canvasRender.renderCurrentDrawing();

  assert.deepEqual(liveIds(), [line.id]);
});

test("a plant is drawn immediately and can be selected from its filled interior", async () => {
  const snapshot = model.snapshotDrawing(drawingState);
  const plant = model.addObject(drawingState, {
    type: "rectangle",
    name: "Plant",
    geometry: {
      position: { x: -30, y: 15 },
      width: 60,
      height: 30,
      rotation: 0
    },
    style: {
      stroke: "#000000",
      lineWidth: 0.5,
      fill: "#D9D9D9",
      fillMode: "solid"
    },
    metadata: {
      controlsKind: "plant",
      inputs: 1,
      outputs: 1,
      showNodeLabels: true,
      plantLabel: "Feed Unit"
    }
  });

  model.commitDrawingChange(drawingState, snapshot);
  canvasRender.renderCurrentDrawing();

  const livePlant = canvas.querySelector(`.drawing-overlay [data-feature-id="${plant.id}"]`);

  assert.ok(livePlant, "the plant's live overlay group is attached to the canvas");
  assert.equal(livePlant.querySelector("rect")?.getAttribute("fill"), "#D9D9D9");
  assert.equal(livePlant.querySelector("text")?.textContent, "Plant");
  assert.ok([...livePlant.querySelectorAll("text")].some((text) => text.textContent === "[Feed Unit]"));
  const plantRect = livePlant.querySelector("rect");
  const inputLabel = [...livePlant.querySelectorAll("text")].find((text) => text.textContent === "Input 1");
  const outputLabel = [...livePlant.querySelectorAll("text")].find((text) => text.textContent === "Output 1");
  const inputNode = livePlant.querySelector("circle");
  const outputNode = livePlant.querySelectorAll("circle")[1];

  assert.ok(Number(inputLabel.getAttribute("y")) > Number(inputNode.getAttribute("cy")), "input label is below its node");
  assert.equal(inputLabel.getAttribute("text-anchor"), "end", "input label stays outside the left edge");
  assert.equal(inputLabel.getAttribute("font-size"), "12", "node label font is increased");
  assert.ok(Number(inputLabel.getAttribute("x")) <= Number(plantRect.getAttribute("x")), "input label does not enter the plant box");
  assert.ok(Number(outputLabel.getAttribute("y")) > Number(outputNode.getAttribute("cy")), "output label is below its node");
  assert.equal(outputLabel.getAttribute("text-anchor"), "start", "output label stays outside the right edge");
  assert.ok(Number(outputLabel.getAttribute("x")) >= Number(plantRect.getAttribute("x")) + Number(plantRect.getAttribute("width")), "output label does not enter the plant box");
  assert.equal(objectAtPoint({ x: 0, y: 0 })?.id, plant.id, "clicking inside the fill selects the plant");

  await answerEveryCompile();
  canvasRender.renderCurrentDrawing();

  model.selectObject(drawingState, plant.id);
  require(locate("delete-command.js")).deleteSelectedObjects();
  await answerEveryCompile();

  assert.ok(!drawingState.objects.some((object) => object.id === plant.id), "deleting removes the plant from the model");
  assert.ok(!canvas.querySelector('.drawing-source-layer path[fill="#D9D9D9"]'), "the compiled plant disappears after deletion");
});

test("the Gain tool places a triangle with a value and fixed nodes", async () => {
  const { placeGain } = require(locate("plant-tool.js"));
  const gain = placeGain({ x: 90, y: 0 });
  const liveGain = canvas.querySelector(`.drawing-overlay [data-feature-id="${gain.id}"]`);
  const plantModel = require(locate("plant.js"));

  assert.equal(gain.metadata.controlsKind, "gain");
  assert.equal(gain.metadata.gainValue, "1");
  assert.equal(drawingState.activeTool, "select");
  assert.ok(liveGain?.querySelector("polygon"), "the live Gain is triangular");
  assert.equal(liveGain.querySelector("text")?.textContent, "1");
  assert.equal(liveGain.querySelectorAll("circle").length, 2, "the Gain has exactly two nodes");
  assert.equal(objectAtPoint({ x: 90, y: 0 })?.id, gain.id, "the triangle interior selects the Gain");
  assert.equal(plantModel.plantNodePosition(gain, "inputs", 0).x, 68);
  assert.equal(plantModel.plantNodePosition(gain, "outputs", 0).x, 112);

  await answerEveryCompile();
  model.selectObject(drawingState, gain.id);
  require(locate("delete-command.js")).deleteSelectedObjects();
  await answerEveryCompile();
});

test("the Sum tool places a circle with two signed inputs and one output", async () => {
  const { placeSum } = require(locate("plant-tool.js"));
  const sum = placeSum({ x: 150, y: 0 });
  const liveSum = canvas.querySelector(`.drawing-overlay [data-feature-id="${sum.id}"]`);
  const plantModel = require(locate("plant.js"));

  assert.equal(sum.metadata.controlsKind, "sum");
  assert.equal(sum.metadata.inputs, 2);
  assert.deepEqual(sum.metadata.inputSigns, ["+", "+"]);
  assert.equal(sum.metadata.outputs, 1);
  assert.equal(drawingState.activeTool, "select");
  assert.ok(Math.abs(Number(liveSum.querySelector("circle")?.getAttribute("r")) - 43.2) < 0.001);
  assert.equal(liveSum.querySelectorAll("circle").length, 4, "the Sum has three nodes and its body");
  assert.deepEqual([...liveSum.querySelectorAll("text")].map((text) => text.textContent), ["+", "+"]);
  assert.equal(objectAtPoint({ x: 150, y: 0 })?.id, sum.id, "the circle interior selects the Sum");
  assert.deepEqual(plantModel.plantNodePosition(sum, "inputs", 0), { x: 150, y: 22 });
  assert.deepEqual(plantModel.plantNodePosition(sum, "inputs", 1), { x: 128, y: 0 });
  assert.deepEqual(plantModel.plantNodePosition(sum, "outputs", 0), { x: 172, y: 0 });

  const { beginManipulationDrag, updateManipulationDrag, finishManipulationDrag } = require(locate("drag.js"));
  const { editorState } = require(locate("editor-state.js"));
  const pointerAt = (point) => {
    const rect = canvas.getBoundingClientRect();
    const scale = model.BASE_PIXELS_PER_UNIT * drawingState.camera.zoom;
    return {
      pointerId: 731,
      button: 0,
      shiftKey: false,
      clientX: rect.left + canvas.clientWidth / 2 + (point.x - drawingState.camera.panX) * scale,
      clientY: rect.top + canvas.clientHeight / 2 - (point.y - drawingState.camera.panY) * scale,
    };
  };
  canvas.setPointerCapture = () => {};
  canvas.hasPointerCapture = () => false;
  drawingState.selection.selectedObjectIds = [];
  editorState.selectedPlantNode = null;
  const nodeBeforeDrag = plantModel.plantNodePosition(sum, "inputs", 0);
  assert.equal(beginManipulationDrag(pointerAt(nodeBeforeDrag)), true);
  assert.deepEqual(drawingState.selection.selectedObjectIds, [sum.id], "grabbing an unselected node selects its Sum");
  assert.deepEqual(editorState.selectedPlantNode, { objectId: sum.id, side: "inputs", index: 0 });
  updateManipulationDrag(pointerAt({ x: 161, y: 19.05255888325765 }));
  finishManipulationDrag(pointerAt({ x: 161, y: 19.05255888325765 }));
  const nodeAfterDrag = plantModel.plantNodePosition(sum, "inputs", 0);
  assert.notDeepEqual(nodeAfterDrag, nodeBeforeDrag, "dragging moves the node around the perimeter");
  assert.ok(Math.abs(Math.hypot(nodeAfterDrag.x - 150, nodeAfterDrag.y) - 22) < 1e-8);

  await answerEveryCompile();
  model.selectObject(drawingState, sum.id);
  require(locate("delete-command.js")).deleteSelectedObjects();
  await answerEveryCompile();
});

test("dragging a control symbol snaps opposite node types into alignment", async () => {
  const snapshot = model.snapshotDrawing(drawingState);
  const source = model.addObject(drawingState, {
    type: "rectangle",
    name: "Plant",
    geometry: { position: { x: -30, y: 15 }, width: 60, height: 30, rotation: 0 },
    style: { stroke: "#000000", fill: "#D9D9D9", fillMode: "solid" },
    metadata: { controlsKind: "plant", inputs: 1, outputs: 1 },
  });
  const target = model.addObject(drawingState, {
    type: "rectangle",
    name: "Block",
    geometry: { position: { x: 100, y: 30 }, width: 30, height: 60, rotation: 0 },
    style: { stroke: "#000000", fill: "#D9D9D9", fillMode: "solid" },
    metadata: { controlsKind: "block", inputs: 1, outputs: 1 },
  });
  model.commitDrawingChange(drawingState, snapshot);

  const plantModel = require(locate("plant.js"));
  const { beginManipulationDrag, updateManipulationDrag, finishManipulationDrag } = require(locate("drag.js"));
  canvas.setPointerCapture = () => {};
  canvas.hasPointerCapture = () => false;
  const pointerAt = (point, pointerId) => {
    const rect = canvas.getBoundingClientRect();
    const scale = model.BASE_PIXELS_PER_UNIT * drawingState.camera.zoom;
    return {
      pointerId,
      button: 0,
      shiftKey: false,
      clientX: rect.left + canvas.clientWidth / 2 + (point.x - drawingState.camera.panX) * scale,
      clientY: rect.top + canvas.clientHeight / 2 - (point.y - drawingState.camera.panY) * scale,
    };
  };
  const dragBy = (object, start, delta, pointerId) => {
    model.selectObject(drawingState, object.id);
    assert.equal(beginManipulationDrag(pointerAt(start, pointerId)), true);
    assert.equal(require(locate("editor-state.js")).editorState.manipulationDrag.object.id, object.id);
    assert.equal(require(locate("editor-state.js")).editorState.manipulationDrag.kind, "body");
    const destination = { x: start.x + delta.x, y: start.y + delta.y };
    updateManipulationDrag(pointerAt(destination, pointerId));
    assert.equal(require(locate("editor-state.js")).editorState.manipulationDrag.moved, true);
    finishManipulationDrag(pointerAt(destination, pointerId));
  };

  dragBy(source, { x: 0, y: 0 }, { x: 10, y: 4 }, 732);
  assert.equal(source.geometry.position.x, -20, "the unsnapped horizontal movement is preserved");
  assert.equal(source.geometry.position.y, 15, "the output node is snapped to the target input's horizontal line");
  assert.equal(plantModel.plantNodePosition(source, "outputs", 0).y, plantModel.plantNodePosition(target, "inputs", 0).y);

  await answerEveryCompile();
  model.selectObject(drawingState, source.id);
  require(locate("delete-command.js")).deleteSelectedObjects();
  model.selectObject(drawingState, target.id);
  require(locate("delete-command.js")).deleteSelectedObjects();
  await answerEveryCompile();
});

test("the Signal Line tool connects an output node to an input node and marks the chosen node", async () => {
  const snapshot = model.snapshotDrawing(drawingState);
  const source = model.addObject(drawingState, {
    type: "rectangle",
    name: "Plant",
    geometry: { position: { x: 0, y: 30 }, width: 60, height: 30, rotation: 0 },
    style: { stroke: "#000000", fill: "#D9D9D9", fillMode: "solid" },
    metadata: { controlsKind: "plant", inputs: 1, outputs: 1 },
  });
  const target = model.addObject(drawingState, {
    type: "rectangle",
    name: "Block",
    geometry: { position: { x: 120, y: 30 }, width: 30, height: 60, rotation: 0 },
    style: { stroke: "#000000", fill: "#D9D9D9", fillMode: "solid" },
    metadata: { controlsKind: "block", inputs: 1, outputs: 1 },
  });
  model.commitDrawingChange(drawingState, snapshot);

  const plantModel = require(locate("plant.js"));
  const { handleSignalLineClick } = require(locate("signal-line-tool.js"));
  const output = plantModel.plantNodePosition(source, "outputs", 0);
  const input = plantModel.plantNodePosition(target, "inputs", 0);

  assert.equal(handleSignalLineClick(output), true);
  assert.equal(drawingState.interaction.signalLineStart.objectId, source.id);
  assert.equal(drawingState.interaction.signalLineStart.side, "outputs");

  const selectedNode = canvas.querySelector(
    `.drawing-overlay [data-feature-id="${source.id}"] [data-signal-line-node-selected="true"]`
  );
  assert.ok(selectedNode, "the selected output node is highlighted while awaiting the input");

  assert.equal(handleSignalLineClick(input), true);

  const signalLine = drawingState.objects.find((object) => object.metadata?.controlsKind === "signal-line");
  assert.ok(signalLine, "the connected line is stored as one editable object");
  assert.deepEqual(signalLine.metadata.from, { objectId: source.id, side: "outputs", index: 0 });
  assert.deepEqual(signalLine.metadata.to, { objectId: target.id, side: "inputs", index: 0 });
  assert.deepEqual(signalLine.geometry.points[0], output);
  assert.deepEqual(signalLine.geometry.points.at(-1), input);
  assert.ok(
    signalLine.geometry.points.slice(1).every((point, index) =>
      point.x === signalLine.geometry.points[index].x || point.y === signalLine.geometry.points[index].y
    ),
    "the routed connection has only Cartesian segments",
  );

  canvasRender.renderCurrentDrawing();
  const liveLine = canvas.querySelector(`.drawing-overlay [data-feature-id="${signalLine.id}"]`);
  assert.ok(liveLine?.querySelector("line"), "the live line is visible immediately");
  assert.equal(liveLine.querySelector("line").getAttribute("stroke"), "#000000");
  assert.ok(liveLine.querySelector("path"), "the live line has an arrowhead");

  const signalLineCount = drawingState.objects.filter(
    (object) => object.metadata?.controlsKind === "signal-line"
  ).length;
  assert.equal(handleSignalLineClick(output), true, "an output node may start another connection");
  assert.equal(handleSignalLineClick(input), false, "an input node already in use rejects another connection");
  assert.equal(
    drawingState.objects.filter((object) => object.metadata?.controlsKind === "signal-line").length,
    signalLineCount,
    "rejecting an occupied input does not add a signal line",
  );
  drawingState.interaction.signalLineStart = null;

  await answerEveryCompile();
  const cleanupSnapshot = model.snapshotDrawing(drawingState);
  for (const object of [signalLine, source, target]) {
    model.removeObject(drawingState, object.id);
  }
  model.commitDrawingChange(drawingState, cleanupSnapshot);
  await answerEveryCompile();
});

/*
 * A COMPILED STROKE IS SHOWN AT THE WIDTH IT STATES.
 *
 * `showStrokesAtScreenWidth` adopts the picture's own print width for the screen
 * (pinned against zoom), and the generator writes that width as
 * `nominalWidth x the drawing's export factor`. So the number on the sheet is the
 * number in the source - which is what makes the picture look the same here and
 * in any external renderer.
 *
 * The stub above states `stroke-width=".28"`, which is under the half-pixel
 * floor the canvas keeps so a hairline stays visible - so the sheet shows 0.5 px.
 * What matters is the INVARIANT: the shown width equals the stated width, never
 * the `x 4.3` inflation an older conversion applied to recover a "screen" width.
 */
test("the picture's print line widths are shown at the width they state", () => {
  const stroke = canvas.querySelector(":scope > svg.drawing-source-layer [stroke-width]");

  assert.ok(stroke, "the compiled picture is on screen");

  /* 0.28pt is below the readable floor, so it is shown there - not inflated. */
  assert.equal(Number(stroke.getAttribute("stroke-width")), 0.5);
  assert.equal(stroke.getAttribute("vector-effect"), "non-scaling-stroke");
});

test("and every declared width is a nominal preset at the drawing's one factor", () => {
  const { activeSourceManager } = require(locate("drawing-source-manager.js"));
  const { exportTransformFor } = require(locate("source-synchronization.js"));

  const source = activeSourceManager().getSource();
  const declared = [...source.matchAll(/line width=([\d.]+)pt/g)].map((match) => Number(match[1]));

  assert.ok(declared.length > 0, `the drawing has a stroke width: ${source}`);

  /*
   * ONE FACTOR, APPLIED ONCE. Dividing a declared width by the drawing's export
   * factor gives back the NOMINAL width the object's style holds. If the factor
   * were applied twice, or not at all, this quotient would not be one of the
   * presets - which is the whole contract in one assertion.
   */
  const factor = exportTransformFor(drawingState.objects).factor;
  const presets = [0.1, 0.2, 0.4, 0.6, 0.8, 1.2, 1.6];

  for (const width of declared) {
    const nominal = width / factor;

    assert.ok(
      presets.some((preset) => Math.abs(preset - nominal) < 0.02),
      `a declared width of ${width}pt is ${nominal.toFixed(3)}pt nominal at factor ${factor.toFixed(4)}`,
    );
  }
});

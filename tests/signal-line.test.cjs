const path = require("node:path");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { JSDOM } = require("jsdom");
const { locate } = require("./helpers/source-path.cjs");

const signalLines = require(locate(path.basename("src/shared/model/signal-line.js")));
const plants = require(locate(path.basename("src/shared/model/plant.js")));
const schema = require(locate(path.basename("src/components/layout/panels/feature-schema.js")));

const makeBlock = (id, x, y, width, height, controlsKind = "block") => ({
  id,
  type: "rectangle",
  geometry: { position: { x, y }, width, height, rotation: 0 },
  metadata: { controlsKind, inputs: 1, outputs: 1 },
});

test("signal node picking returns only the requested input or output node", () => {
  const plant = makeBlock("plant", 0, 30, 60, 30, "plant");
  const input = plants.plantNodePosition(plant, "inputs", 0);
  const output = plants.plantNodePosition(plant, "outputs", 0);

  assert.deepEqual(input, { x: -4, y: 15 });
  assert.deepEqual(signalLines.signalNodeAtPoint([plant], input, 2, "inputs")?.side, "inputs");
  assert.deepEqual(signalLines.signalNodeAtPoint([plant], output, 2, "outputs")?.side, "outputs");
  assert.equal(signalLines.signalNodeAtPoint([plant], input, 2, "outputs"), null);
});

test("Gain exposes its flat-side input and point-side output to Signal Line", () => {
  const gain = makeBlock("gain", 0, 15, 36, 30, "gain");
  const input = plants.plantNodePosition(gain, "inputs", 0);
  const output = plants.plantNodePosition(gain, "outputs", 0);

  assert.deepEqual(input, { x: -4, y: 0 });
  assert.deepEqual(output, { x: 40, y: 0 });
  assert.equal(signalLines.signalNodeAtPoint([gain], input, 2, "inputs")?.object.id, "gain");
  assert.equal(signalLines.signalNodeAtPoint([gain], output, 2, "outputs")?.object.id, "gain");
});

test("Sum nodes are discoverable by Signal Line", () => {
  const sum = {
    id: "sum",
    type: "circle",
    geometry: { center: { x: 0, y: 0 }, radius: 18 },
    metadata: { controlsKind: "sum", inputs: 2 },
  };
  const input = plants.plantNodePosition(sum, "inputs", 0);
  const output = plants.plantNodePosition(sum, "outputs", 0);

  assert.equal(signalLines.signalNodeAtPoint([sum], input, 2, "inputs")?.index, 0);
  assert.equal(signalLines.signalNodeAtPoint([sum], output, 2, "outputs")?.side, "outputs");
});

test("an input accepts one signal line while an output can be reused", () => {
  const firstLine = {
    type: "polyline",
    geometry: { points: [{ x: 0, y: 0 }, { x: 1, y: 0 }] },
    metadata: {
      controlsKind: "signal-line",
      from: { objectId: "source", side: "outputs", index: 0 },
      to: { objectId: "target", side: "inputs", index: 0 },
    },
  };
  const secondLine = {
    type: "polyline",
    metadata: {
      controlsKind: "signal-line",
      from: { objectId: "other-source", side: "outputs", index: 0 },
      to: { objectId: "target", side: "inputs", index: 0 },
    },
  };

  assert.equal(signalLines.signalInputIsConnected([firstLine], "target", 0), true);
  assert.equal(signalLines.signalInputIsConnected([firstLine, secondLine], "target", 0), true);
  assert.equal(signalLines.signalInputIsConnected([firstLine], "target", 1), false);
  assert.equal(signalLines.signalInputIsConnected([firstLine], "source", 0), false);
});

test("signal routes stay attached to their node references when blocks move", () => {
  const source = makeBlock("source", 0, 30, 60, 30, "plant");
  const target = makeBlock("target", 120, 30, 30, 60);
  const line = {
    type: "polyline",
    geometry: { points: [{ x: 0, y: 0 }, { x: 1, y: 0 }] },
    metadata: {
      controlsKind: "signal-line",
      from: { objectId: "source", side: "outputs", index: 0 },
      to: { objectId: "target", side: "inputs", index: 0 },
    },
  };
  const objects = [source, target, line];

  assert.deepEqual(signalLines.signalLinePath(line, objects)[0], { x: 64, y: 15 });
  assert.deepEqual(signalLines.signalLinePath(line, objects).at(-1), { x: 116, y: 0 });
  target.geometry.position.x = 160;
  assert.deepEqual(signalLines.signalLinePath(line, objects).at(-1), { x: 156, y: 0 });
});

test("signal routes use only horizontal and vertical segments and go around blocks", () => {
  const source = makeBlock("source", 0, 30, 60, 30, "plant");
  const obstacle = makeBlock("obstacle", 65, 26, 20, 12);
  const target = makeBlock("target", 120, 30, 30, 60);
  const start = plants.plantNodePosition(source, "inputs", 0);
  const end = plants.plantNodePosition(target, "outputs", 0);
  const path = signalLines.routeSignalLine(start, end, [source, obstacle, target]);

  assert.ok(path, "a route exists around the obstacle");
  assert.deepEqual(path[0], start);
  assert.deepEqual(path[path.length - 1], end);

  for (let index = 1; index < path.length; index += 1) {
    const previous = path[index - 1];
    const current = path[index];
    assert.ok(previous.x === current.x || previous.y === current.y, "every segment is Cartesian");
  }

  assert.ok(path.some(point => point.y > 28 || point.y < -2), "the route clears the intervening block");
});

test("a crossing cuts a gap in the earlier signal line", () => {
  const previous = {
    type: "polyline",
    geometry: { points: [{ x: 0, y: 0 }, { x: 20, y: 0 }] },
    metadata: { controlsKind: "signal-line" },
  };
  const later = {
    type: "polyline",
    geometry: { points: [{ x: 10, y: -10 }, { x: 10, y: 10 }] },
    metadata: { controlsKind: "signal-line" },
  };

  const segments = signalLines.signalLineSegments(previous, [previous, later]);

  assert.deepEqual(segments.map(segment => [segment.start.x, segment.end.x]), [
    [0, 8.5],
    [11.5, 20],
  ]);
  assert.equal(signalLines.signalLineSegments(later, [previous, later]).length, 1, "the newer path stays continuous");
});

test("signal lines render as black arrows with a visible crossover cut", () => {
  const { drawPolyline } = require(locate(path.basename("src/shared/rendering/entities/draw-geometry.js")));
  const dom = new JSDOM("<svg></svg>");
  const originalDocument = globalThis.document;
  const svg = dom.window.document.querySelector("svg");
  const earlier = {
    type: "polyline",
    geometry: { points: [{ x: 0, y: 0 }, { x: 20, y: 0 }] },
    metadata: { controlsKind: "signal-line" },
  };
  const later = {
    type: "polyline",
    geometry: { points: [{ x: 10, y: -10 }, { x: 10, y: 10 }] },
    metadata: { controlsKind: "signal-line" },
  };

  try {
    globalThis.document = dom.window.document;
    drawPolyline({
      svg,
      entity: earlier,
      state: { objects: [earlier, later] },
      geometry: earlier.geometry,
      style: { stroke: "#ff0000" },
      toScreen: point => point,
    });

    const strokes = [...svg.querySelectorAll("line")];
    assert.equal(strokes.length, 2);
    assert.equal(strokes[0].getAttribute("stroke"), "#000000");
    assert.equal(strokes[0].getAttribute("x2"), "8.5");
    assert.equal(strokes[1].getAttribute("x1"), "11.5");
    assert.equal(svg.querySelector("path")?.getAttribute("fill"), "#000000");
  } finally {
    globalThis.document = originalDocument;
    dom.window.close();
  }
});

test("Signal Line Features shows its type but not editable appearance or transforms", () => {
  const line = {
    type: "polyline",
    geometry: { points: [{ x: 0, y: 0 }, { x: 1, y: 0 }] },
    metadata: { controlsKind: "signal-line" },
  };

  assert.equal(schema.typeLabelOf(line), "Signal Line");
  assert.deepEqual(schema.groupsFor(line), []);
  assert.equal(schema.supportsTransform(line), false);
});

const path = require("path");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { JSDOM } = require("jsdom");
const { locate } = require("./helpers/source-path.cjs");

const src = (file) => require(locate(path.basename(file)));
const plantModel = src("src/shared/model/plant.js");
const blockLabelFormat = src("src/shared/model/block-label.js");
const featureGeometry = src("src/shared/geometry/feature-geometry.js").default;
const schema = src("src/components/layout/panels/feature-schema.js");
const { editorState } = src("src/features/workspace/editor-state.js");

const plant = {
  id: "plant-1",
  type: "rectangle",
  geometry: {
    position: { x: 0, y: 30 },
    width: 60,
    height: 30,
    rotation: 0,
  },
  style: { fill: "#e5e7eb", fillMode: "solid" },
  metadata: { controlsKind: "plant", inputs: 1, outputs: 1 },
};
const block = {
  id: "block-1",
  type: "rectangle",
  geometry: {
    position: { x: 0, y: 30 },
    width: 30,
    height: 60,
    rotation: 0,
  },
  style: { fill: "#D9D9D9", fillMode: "solid" },
  metadata: { controlsKind: "block", inputs: 2, outputs: 1 },
};

test("plants default to visible node labels and the lighter gray fill", () => {
  assert.equal(plantModel.plantValue(plant, "showNodeLabels"), true);
  assert.equal(plantModel.plantStyle(plant.style).fill, "#D9D9D9");
  assert.equal(plantModel.plantValue(plant, "plantLabel"), "");
  assert.equal(plantModel.plantNodeLabel(plant, "inputs", 1), undefined);
});

test("plant node picking identifies the input and output terminals", () => {
  assert.deepEqual(plantModel.plantNodeAtPoint(plant, { x: -4, y: 15 }, 2), {
    side: "inputs",
    index: 0,
  });
  assert.deepEqual(plantModel.plantNodeAtPoint(plant, { x: 64, y: 15 }, 2), {
    side: "outputs",
    index: 0,
  });
});

test("Block reuses node options and labels but has no plant label", () => {
  assert.equal(plantModel.isBlock(block), true);
  assert.equal(plantModel.plantValue(block, "showNodeLabels"), true);
  assert.equal(plantModel.plantValue(block, "plantLabel"), "");
  assert.deepEqual(plantModel.plantNodeAtPoint(block, { x: -4, y: 28 }, 2), {
    side: "inputs",
    index: 0,
  });
  assert.equal(plantModel.setPlantNodeLabel(block, "inputs", 0, "Feed"), true);
  assert.equal(plantModel.plantNodeLabel(block, "inputs", 0), "Feed");
  assert.equal(plantModel.setPlantValue(block, "blockLabel", "m/s^2"), true);
  assert.equal(plantModel.setPlantValue(block, "blockLowerLabel", "Acceleration"), true);
  assert.equal(plantModel.plantValue(block, "blockLabel"), "m/s^2");
  assert.equal(plantModel.plantValue(block, "blockLowerLabel"), "Acceleration");
  assert.equal(blockLabelFormat.blockLabelLatex("m/s^2"), "\\frac{m}{s^{2}}");
  const documentRef = new JSDOM("<svg></svg>").window.document;
  const formulaGroup = documentRef.createElementNS("http://www.w3.org/2000/svg", "g");
  blockLabelFormat.appendBlockLabelSvg(formulaGroup, "m/s^2", documentRef, {
    x: 50,
    y: 40,
    fill: "#000000",
    fontSize: 10,
  });
  const fractionTexts = [...formulaGroup.querySelectorAll("text")];
  assert.equal(fractionTexts.length, 2);
  assert.equal(fractionTexts[0].textContent, "m");
  assert.equal(fractionTexts[1].textContent, "s2");
  assert.ok(Number(fractionTexts[0].getAttribute("y")) < Number(fractionTexts[1].getAttribute("y")));
  assert.ok(formulaGroup.querySelector("line"), "the live fraction has a horizontal bar");
  assert.equal(fractionTexts[1].querySelector("tspan")?.getAttribute("baseline-shift"), "super");

  editorState.selectedPlantNode = { objectId: block.id, side: "inputs", index: 0 };
  const fields = schema.groupsFor(block).find((group) => group.id === "plant").fields;
  assert.deepEqual(fields.map((field) => field.key), [
    "plantInputs",
    "plantOutputs",
    "plantShowNodeLabels",
    "blockLabel",
    "blockLowerLabel",
    "plantNodeLabel",
  ]);
  assert.equal(schema.typeLabelOf(block), "Block");
  editorState.selectedPlantNode = null;
});

test("plant rotations snap to 90-degree intervals without constraining other rectangles", () => {
  const pivot = { x: 30, y: 15 };

  featureGeometry.rotateObjectAbout(plant, pivot, 30 * Math.PI / 180);
  assert.equal(plant.geometry.rotation, 0);

  featureGeometry.rotateObjectAbout(plant, pivot, 70 * Math.PI / 180);
  assert.equal(plant.geometry.rotation, 90);

  featureGeometry.rotateObjectAbout(plant, pivot, -90 * Math.PI / 180);
  assert.equal(plant.geometry.rotation, 0);

  const rectangle = {
    type: "rectangle",
    geometry: { position: { x: 0, y: 30 }, width: 60, height: 30, rotation: 0 },
  };
  featureGeometry.rotateObjectAbout(rectangle, pivot, 30 * Math.PI / 180);
  assert.equal(rectangle.geometry.rotation, 30);
});

test("Features exposes a label editor only for the selected plant node", () => {
  editorState.selectedPlantNode = { objectId: plant.id, side: "inputs", index: 0 };

  assert.equal(schema.readField(plant, "plantNodeLabel"), "Input 1");
  assert.equal(schema.writeField(plant, "plantNodeLabel", "Feed"), true);
  assert.equal(schema.readField(plant, "plantNodeLabel"), "Feed");
  assert.equal(plantModel.plantNodeLabel(plant, "inputs", 0), "Feed");
  assert.equal(schema.writeField(plant, "plantLabel", "Feed Unit"), true);
  assert.equal(plantModel.plantValue(plant, "plantLabel"), "Feed Unit");

  editorState.selectedPlantNode = null;
  assert.equal(schema.readField(plant, "plantNodeLabel"), undefined);
});

test("Gain has one fixed input, one fixed output, and only an editable center value", () => {
  const gain = {
    id: "gain-1",
    type: "rectangle",
    geometry: {
      position: { x: -18, y: 15 },
      width: 36,
      height: 30,
      rotation: 0,
    },
    style: { fill: "#D9D9D9", fillMode: "solid" },
    metadata: { controlsKind: "gain", gainValue: "K" },
  };
  const groups = schema.groupsFor(gain);

  assert.equal(plantModel.isGain(gain), true);
  assert.equal(schema.typeLabelOf(gain), "Gain");
  assert.deepEqual(plantModel.gainTrianglePoints(gain), [
    { x: -18, y: 15 },
    { x: -18, y: -15 },
    { x: 18, y: 0 },
  ]);
  assert.deepEqual(plantModel.plantNodePosition(gain, "inputs", 0), { x: -22, y: 0 });
  assert.deepEqual(plantModel.plantNodePosition(gain, "outputs", 0), { x: 22, y: 0 });
  assert.equal(plantModel.plantValue(gain, "inputs"), 1);
  assert.equal(plantModel.plantValue(gain, "outputs"), 1);
  assert.deepEqual(groups.find((group) => group.id === "gain").fields.map((field) => field.key), ["gainValue"]);
  assert.equal(schema.readField(gain, "gainValue"), "K");
  assert.equal(schema.writeField(gain, "gainValue", "2.5"), true);
  assert.equal(schema.readField(gain, "gainValue"), "2.5");
  assert.equal(schema.writeField(gain, "plantInputs", 2), false);
  assert.equal(plantModel.setPlantValue(gain, "inputs", 2), false);
  assert.equal(plantModel.setPlantNodeLabel(gain, "inputs", 0, "In"), false);
});

test("Sum inputs default to top and left with editable signs", () => {
  const sum = {
    id: "sum-1",
    type: "circle",
    geometry: { center: { x: 0, y: 0 }, radius: 18 },
    style: { fill: "#D9D9D9", fillMode: "solid" },
    metadata: { controlsKind: "sum", inputs: 2, outputs: 1 },
  };

  assert.equal(plantModel.isSum(sum), true);
  assert.equal(schema.typeLabelOf(sum), "Sum");
  assert.equal(plantModel.plantValue(sum, "inputs"), 2);
  assert.equal(plantModel.plantValue(sum, "outputs"), 1);
  assert.deepEqual(plantModel.plantNodePosition(sum, "inputs", 0), { x: 0, y: 22 });
  assert.deepEqual(plantModel.plantNodePosition(sum, "inputs", 1), { x: -22, y: 0 });
  assert.deepEqual(plantModel.plantNodePosition(sum, "outputs", 0), { x: 22, y: 0 });
  assert.deepEqual(plantModel.sumInputSignPosition(sum, 0), { x: 0, y: 11 });
  assert.equal(plantModel.sumInputSign(sum, 0), "+");
  assert.equal(plantModel.sumInputSign(sum, 1), "+");

  const group = schema.groupsFor(sum).find((candidate) => candidate.id === "sum");
  assert.deepEqual(group.fields.map((field) => field.key), ["sumInputs"]);
  assert.equal(schema.writeField(sum, "sumInputs", 4), true);
  assert.equal(plantModel.plantValue(sum, "inputs"), 4);
  assert.deepEqual(sum.metadata.inputSigns, ["+", "+", "+", "+"]);
  assert.equal(schema.writeField(sum, "sumInputs", 1), false);

  editorState.selectedPlantNode = { objectId: sum.id, side: "inputs", index: 2 };
  assert.equal(schema.readField(sum, "sumInputSign"), "+");
  assert.equal(schema.writeField(sum, "sumInputSign", "-"), true);
  assert.equal(plantModel.sumInputSign(sum, 2), "-");
  assert.deepEqual(schema.groupsFor(sum).find((candidate) => candidate.id === "sum").fields.map((field) => field.key), [
    "sumInputs",
    "sumInputSign",
  ]);
  editorState.selectedPlantNode = null;
});

test("Sum nodes move around the perimeter but reject positions too close to another node", () => {
  const sum = {
    id: "sum-drag",
    type: "circle",
    geometry: { center: { x: 10, y: 20 }, radius: 18 },
    metadata: { controlsKind: "sum", inputs: 2 },
  };
  const before = plantModel.plantNodePosition(sum, "inputs", 0);

  assert.equal(plantModel.setSumNodeAngle(sum, "inputs", 0, Math.PI / 3), true);
  const moved = plantModel.plantNodePosition(sum, "inputs", 0);
  assert.notDeepEqual(moved, before);
  assert.ok(Math.abs(Math.hypot(moved.x - 10, moved.y - 20) - 22) < 1e-8);

  const otherInput = plantModel.plantNodePosition(sum, "inputs", 1);
  const closeAngle = Math.atan2(otherInput.y - 20, otherInput.x - 10);
  assert.equal(plantModel.setSumNodeAngle(sum, "inputs", 0, closeAngle), false);
  assert.deepEqual(plantModel.plantNodePosition(sum, "inputs", 0), moved);

  assert.equal(plantModel.setSumNodeAngle(sum, "outputs", 0, Math.PI / 2), true);
  const output = plantModel.plantNodePosition(sum, "outputs", 0);
  assert.ok(Math.abs(Math.hypot(output.x - 10, output.y - 20) - 22) < 1e-8);
});

test("Sum rotates in 90-degree increments and carries its nodes with it", () => {
  const sum = {
    id: "sum-rotate",
    type: "circle",
    geometry: { center: { x: 10, y: 20 }, radius: 18, rotation: 0 },
    metadata: { controlsKind: "sum", inputs: 2 },
  };

  featureGeometry.rotateObjectAbout(sum, { x: 10, y: 20 }, Math.PI / 2 + 0.02);

  assert.equal(sum.geometry.rotation, 90);
  const output = plantModel.plantNodePosition(sum, "outputs", 0);
  const input = plantModel.plantNodePosition(sum, "inputs", 0);
  assert.ok(Math.abs(output.x - 10) < 1e-9 && Math.abs(output.y - 42) < 1e-9);
  assert.ok(Math.abs(input.x + 12) < 1e-9 && Math.abs(input.y - 20) < 1e-9);
});

test("control-node alignment offsets snap opposite nodes on either axis within six units", () => {
  const moving = {
    id: "moving-control",
    type: "rectangle",
    geometry: { position: { x: 0, y: 15 }, width: 60, height: 30, rotation: 0 },
    metadata: { controlsKind: "plant", inputs: 1, outputs: 1 },
  };
  const horizontalTarget = {
    id: "horizontal-target",
    type: "rectangle",
    geometry: { position: { x: -22, y: 30 }, width: 30, height: 60, rotation: 0 },
    metadata: { controlsKind: "block", inputs: 1, outputs: 1 },
  };
  const verticalTarget = {
    id: "vertical-target",
    type: "rectangle",
    geometry: { position: { x: 200, y: 30 }, width: 30, height: 60, rotation: 0 },
    metadata: { controlsKind: "block", inputs: 1, outputs: 1 },
  };

  assert.deepEqual(
    plantModel.controlNodeAlignmentOffset(moving, [horizontalTarget], 10, 0),
    { dx: 6, dy: 0 },
  );
  assert.deepEqual(
    plantModel.controlNodeAlignmentOffset(moving, [verticalTarget], 0, 4),
    { dx: 0, dy: -4 },
  );
  assert.equal(plantModel.controlNodeAlignmentOffset(moving, [verticalTarget], 0, 7), null);
});

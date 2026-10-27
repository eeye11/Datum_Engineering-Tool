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

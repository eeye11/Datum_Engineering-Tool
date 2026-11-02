const { bootApp } = require("./tests/helpers/boot-app.cjs");
const { locate } = require("./tests/helpers/source-path.cjs");

bootApp();

const tool = require(locate("junction-tool.js"));
const pipe = require(locate("model/fluids/pipe-duct.js")).default;
const junctionModel = require(locate("model/fluids/junction.js")).default;
const state = require(locate("editor-state.js")).drawingState;

state.objects = [];
state.selection.selectedObjectIds = [];

const host = pipe.createPipeDuct({ x: 0, y: 0 }, { x: 200, y: 0 });
const branch = pipe.createPipeDuct({ x: 100, y: 80 }, { x: 100, y: 0 });
state.objects = [host, branch];

const made = tool.createJunctionForInteriorConnection(branch, state.objects);

console.log("branch 2 (c):", JSON.stringify(made.geometry.branches[2]));
console.log(
  "port of c:",
  JSON.stringify(junctionModel.branchPort(made, made.geometry.branches[2])),
);
console.log("branch pipe after:", JSON.stringify(branch.geometry));

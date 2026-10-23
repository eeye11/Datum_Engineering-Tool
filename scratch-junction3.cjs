const { bootApp } = require("./tests/helpers/boot-app.cjs");
const { locate } = require("./tests/helpers/source-path.cjs");

bootApp();

const junctionModel = require(locate("model/fluids/junction.js")).default;
const tool = require(locate("junction-tool.js"));
const state = require(locate("editor-state.js")).drawingState;

state.objects = [];
state.selection.selectedObjectIds = [];

const set = tool.defaultBranchSet({ x: 1, y: 0 });
console.log("branch set:", JSON.stringify(set));

const built = junctionModel.createJunction({
  position: { x: 0, y: 0 },
  branches: set,
  style: {},
});

console.log("created:", built && built.type, built && built.name);
console.log(
  "all object types:",
  state.objects.map((o) => o.type),
);

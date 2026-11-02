const { bootApp } = require("./tests/helpers/boot-app.cjs");
const { locate } = require("./tests/helpers/source-path.cjs");

bootApp();

const tool = require(locate("pipe-duct-tool.js"));
const pipe = require(locate("model/fluids/pipe-duct.js")).default;
const state = require(locate("editor-state.js")).drawingState;

state.objects = [];

const a = pipe.createPipeDuct({ x: 0, y: 0 }, { x: 100, y: 0 });
const b = pipe.createPipeDuct({ x: 203.92, y: 60 }, { x: 100, y: 0 });
state.objects = [a, b];

const made = tool.connectPipeEndpoints(b);
const elbow = state.objects.find((o) => o.type === "elbow");

console.log("after connect:", JSON.stringify(elbow.geometry));
console.log(
  "ports:",
  elbow.engineering.ports,
  "conns:",
  elbow.engineering.connections,
);

const corner = tool.cornerOf(elbow, state.objects);
console.log("cornerOf:", JSON.stringify(corner));

process.exit(0);

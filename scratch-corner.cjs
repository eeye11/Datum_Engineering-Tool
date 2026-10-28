const { bootApp } = require("./tests/helpers/boot-app.cjs");
const { locate } = require("./tests/helpers/source-path.cjs");

bootApp();

const tool = require(locate("pipe-duct-tool.js"));
const pipe = require(locate("model/fluids/pipe-duct.js")).default;
const state = require(locate("editor-state.js")).drawingState;

state.objects = [];

const a = pipe.createPipeDuct({ x: 0, y: 0 }, { x: 100, y: 0 });
const b = pipe.createPipeDuct({ x: 300, y: 150 }, { x: 100, y: 0 });
state.objects = [a, b];

tool.connectPipeEndpoints(b);

const elbow = state.objects.find((o) => o.type === "elbow");
console.log(
  "ports:",
  elbow.engineering.ports,
  "connections:",
  elbow.engineering.connections,
);

console.log("a:", JSON.stringify(a.geometry));
console.log("b:", JSON.stringify(b.geometry));

b.geometry.start = { x: 400, y: 400 };

console.log("\n-- after moving b.start to (400,400) --");
console.log("a:", JSON.stringify(a.geometry));
console.log("b:", JSON.stringify(b.geometry));

const corner = tool.cornerOf(elbow, state.objects);
console.log("cornerOf:", corner ? JSON.stringify(corner) : null);

setTimeout(() => process.exit(0), 300);

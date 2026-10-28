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
console.log("elbow connections:", elbow.engineering.connections);

console.log("\n-- disconnect b.start to (400,400) --");
b.geometry.start = { x: 400, y: 400 };

console.log("a:", JSON.stringify(a.geometry).slice(0, 120));
console.log("b:", JSON.stringify(b.geometry).slice(0, 120));

const joint = tool.joiningCornerOf(a, b);
console.log(
  "joiningCornerOf after disconnect:",
  joint && JSON.stringify(joint).slice(0, 160),
);
console.log(
  "cornerOf:",
  tool.cornerOf(elbow, state.objects) ? "STILL A CORNER" : "null",
);

const result = tool.refreshFluidConnections(b, state.objects);
console.log("refresh:", JSON.stringify(result));

setTimeout(() => process.exit(0), 300);

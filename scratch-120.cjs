const { bootApp } = require("./tests/helpers/boot-app.cjs");
const { locate } = require("./tests/helpers/source-path.cjs");

bootApp();

const tool = require(locate("pipe-duct-tool.js"));
const pipe = require(locate("model/fluids/pipe-duct.js")).default;
const state = require(locate("editor-state.js")).drawingState;

const radians = (120 * Math.PI) / 180;
const far = { x: 100 + 120 * Math.cos(radians), y: 120 * Math.sin(radians) };

state.objects = [];

const a = pipe.createPipeDuct({ x: 0, y: 0 }, { x: 100, y: 0 });
const b = pipe.createPipeDuct(far, { x: 100, y: 0 });
state.objects = [a, b];

console.log("a:", JSON.stringify(a.geometry));
console.log("b:", JSON.stringify(b.geometry));

const joint = tool.joiningCornerOf(a, b);
console.log("joiningCornerOf(a,b):", JSON.stringify(joint));

const joint2 = tool.joiningCornerOf(b, a);
console.log("joiningCornerOf(b,a):", JSON.stringify(joint2));

const made = tool.connectPipeEndpoints(b);
const elbow = state.objects.find((o) => o.type === "elbow");

console.log("\nelbow ports:", JSON.stringify(elbow.engineering.ports));
console.log(
  "elbow connections:",
  JSON.stringify(elbow.engineering.connections),
);
console.log("elbow geometry:", JSON.stringify(elbow.geometry));

console.log("\na.id < b.id:", a.id < b.id);

process.exit(0);

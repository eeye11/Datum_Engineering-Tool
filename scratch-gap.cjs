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

console.log("elbow geometry:", JSON.stringify(elbow.geometry));
console.log("elbow legs:", JSON.stringify(pipe.elbowLegs(elbow)));
console.log("elbow radius:", elbow.engineering.bendRadius);
console.log("elbow ports:", JSON.stringify(elbow.engineering.ports));
console.log("connections:", JSON.stringify(elbow.engineering.connections));
console.log("\na:", JSON.stringify(a.geometry));
console.log("b:", JSON.stringify(b.geometry));

const curves = pipe.elbowCurvesFor(elbow);
console.log("\ncurves start:", curves.start, "end:", curves.end);
console.log("trim:", curves.trim);

process.exit(0);

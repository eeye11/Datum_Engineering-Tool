const { bootApp } = require("./tests/helpers/boot-app.cjs");
const { locate } = require("./tests/helpers/source-path.cjs");

bootApp();

const tool = require(locate("pipe-duct-tool.js"));
const pipe = require(locate("model/fluids/pipe-duct.js")).default;
const state = require(locate("editor-state.js")).drawingState;

state.objects = [];
state.selection.selectedObjectIds = [];

const a = pipe.createPipeDuct({ x: 0, y: 0 }, { x: 100, y: 0 });
const b = pipe.createPipeDuct({ x: 100, y: 0 }, { x: 200, y: 100 });
state.objects = [a, b];

console.log("a:", JSON.stringify(a.geometry));
console.log("b:", JSON.stringify(b.geometry));

const joint = tool.joiningCornerOf(a, b);
console.log("joint:", JSON.stringify(joint));

const angle =
  joint && pipe.cornerAngleDegrees(joint.before, joint.vertex, joint.after);
console.log("angle:", angle, "supported:", pipe.supportedElbowAngle(angle));

const made = tool.generateElbowFor(a, b, pipe.defaultPipeEngineering());
console.log(
  "generateElbowFor:",
  made ? made.type + " " + made.engineering.angleDegrees : null,
);

console.log(
  "objects now:",
  state.objects.map((o) => o.type),
);

const discovered = tool.connectPipeEndpoints(a);
console.log(
  "discovered:",
  discovered.length,
  "objects:",
  state.objects.map((o) => o.type),
);

setTimeout(() => process.exit(0), 300);

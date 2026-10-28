const { bootApp } = require("./tests/helpers/boot-app.cjs");
const { locate } = require("./tests/helpers/source-path.cjs");

bootApp();

const tool = require(locate("pipe-duct-tool.js"));
const pipe = require(locate("model/fluids/pipe-duct.js")).default;
const state = require(locate("editor-state.js")).drawingState;

state.objects = [];

/* Both runs lie ON the same line: A ends at (100,0), B starts there. */
const a = pipe.createPipeDuct({ x: 0, y: 0 }, { x: 100, y: 0 });
const b = pipe.createPipeDuct({ x: 100, y: 0 }, { x: 200, y: 0 });
state.objects = [a, b];

const joint = tool.joiningCornerOf(a, b);
const angle =
  joint && pipe.cornerAngleDegrees(joint.before, joint.vertex, joint.after);

console.log("collinear joint:", JSON.stringify(joint));
console.log("angle:", angle, "-> supported:", pipe.supportedElbowAngle(angle));

const made = tool.connectPipeEndpoints(b);
console.log(
  "made:",
  made.length,
  "objects:",
  state.objects.map((o) => o.type),
);

setTimeout(() => process.exit(0), 300);

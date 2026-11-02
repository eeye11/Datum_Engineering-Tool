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
const radius0 = elbow.engineering.bendRadius;

console.log(
  "initial angle",
  pipe.elbowAngleDegrees(elbow).toFixed(2),
  "radius",
  radius0,
);

/* Change the angle by moving b's far end. */
b.geometry.start = { x: 100, y: 200 };
tool.refreshFluidConnections(b);

console.log(
  "after angle change:",
  pipe.elbowAngleDegrees(elbow).toFixed(2),
  "radius",
  elbow.engineering.bendRadius,
);
console.log("radius preserved:", elbow.engineering.bendRadius === radius0);

/* No duplicate on repeated refresh. */
tool.connectPipeEndpoints(b);
tool.refreshFluidConnections(b);
console.log(
  "elbows after repeat:",
  state.objects.filter((o) => o.type === "elbow").length,
);

/* Break the join. */
b.geometry.start = { x: 400, y: 400 };
tool.refreshFluidConnections(b);
console.log(
  "elbows after disconnect:",
  state.objects.filter((o) => o.type === "elbow").length,
);
console.log("a trims cleared:", a.geometry.trims === undefined);

/* Rejoin. */
b.geometry.start = { x: 100, y: 0 };
const re = tool.connectPipeEndpoints(b);
console.log(
  "elbows after rejoin:",
  state.objects.filter((o) => o.type === "elbow").length,
  `(made ${re.length})`,
);

setTimeout(() => process.exit(0), 300);

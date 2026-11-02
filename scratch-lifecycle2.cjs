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
  "1. created:",
  pipe.elbowAngleDegrees(elbow).toFixed(1),
  "deg, radius",
  radius0,
);

/* Rotate b by moving its FAR end: the elbow must follow, radius held. */
b.geometry.start = { x: 100, y: 300 };
tool.connectPipeEndpoints(b);
tool.refreshFluidConnections(b);
console.log(
  "2. rotated:",
  pipe.elbowAngleDegrees(elbow).toFixed(1),
  "deg, radius",
  elbow.engineering.bendRadius,
  "| preserved:",
  elbow.engineering.bendRadius === radius0,
);

/* GENUINELY break the join: move b's JOINED end away. */
b.geometry.end = { x: 600, y: 600 };
tool.refreshFluidConnections(b);

console.log(
  "3. after real disconnect -> elbows:",
  state.objects.filter((o) => o.type === "elbow").length,
);
console.log("   a trims cleared:", a.geometry.trims === undefined);

/* Rejoin at a new angle. */
b.geometry.end = { x: 100, y: 0 };
b.geometry.start = { x: 250, y: 250 };
const made = tool.connectPipeEndpoints(b);
console.log(
  "4. after rejoin -> elbows:",
  state.objects.filter((o) => o.type === "elbow").length,
  `(made ${made.length})`,
);

/* No duplicates across repeated passes. */
tool.connectPipeEndpoints(b);
tool.refreshFluidConnections(b);
tool.connectPipeEndpoints(a);
console.log(
  "5. after repeats -> elbows:",
  state.objects.filter((o) => o.type === "elbow").length,
);

setTimeout(() => process.exit(0), 300);

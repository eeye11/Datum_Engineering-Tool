const { bootApp } = require("./tests/helpers/boot-app.cjs");
const { locate } = require("./tests/helpers/source-path.cjs");

bootApp();

const tool = require(locate("pipe-duct-tool.js"));
const pipe = require(locate("model/fluids/pipe-duct.js")).default;
const state = require(locate("editor-state.js")).drawingState;

function reset() {
  state.objects = [];
  state.selection.selectedObjectIds = [];
  state.interaction.previousRun = null;
  state.interaction.routeCommittedCount = 0;
}

const angles = [30, 45, 60, 90, 120, 135, 180, 0];

console.log("=== 1. Draw-time generation ===");

angles.forEach((angle) => {
  reset();

  const first = tool.commitRouteSegment({ x: 0, y: 0 }, { x: 100, y: 0 }, {});

  const radians = (angle * Math.PI) / 180;
  const end = { x: 100 + 100 * Math.cos(radians), y: 100 * Math.sin(radians) };

  const second = tool.commitRouteSegment({ x: 100, y: 0 }, end, {
    previousRun: first.run,
    routeCommittedCount: 1,
  });

  console.log(
    `  ${String(angle).padStart(3)} deg -> elbow: ${second.elbow ? "YES" : "no "}`,
    second.elbow
      ? `angle ${pipe.elbowAngleDegrees(second.elbow).toFixed(1)}`
      : "",
  );
});

console.log("\n=== 2. Two EXISTING pipes brought together (no tool) ===");

angles.forEach((angle) => {
  reset();

  const a = pipe.createPipeDuct({ x: 0, y: 0 }, { x: 100, y: 0 });
  const radians = (angle * Math.PI) / 180;
  const bStart = {
    x: 100 + 100 * Math.cos(radians),
    y: 100 * Math.sin(radians),
  };
  const b = pipe.createPipeDuct(bStart, { x: 300, y: 200 });

  state.objects = [a, b];

  /* Drag b's start onto a's end, the way a handle drag would. */
  b.geometry.start = { x: 100, y: 0 };

  const before = state.objects.filter((o) => o.type === "elbow").length;
  tool.refreshFluidConnections(b, state.objects);
  tool.connectPipeEndpoints(state.objects);
  const after = state.objects.filter((o) => o.type === "elbow").length;

  console.log(
    `  ${String(angle).padStart(3)} deg -> elbows before ${before}, after ${after}`,
  );
});

setTimeout(() => process.exit(0), 300);

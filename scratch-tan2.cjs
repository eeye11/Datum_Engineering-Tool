const { bootApp } = require("./tests/helpers/boot-app.cjs");
const { locate } = require("./tests/helpers/source-path.cjs");

ready = bootApp();

const tool = require(locate("pipe-duct-tool.js"));
const pipe = require(locate("model/fluids/pipe-duct.js")).default;
const state = require(locate("editor-state.js")).drawingState;

function reset() {
  state.objects = [];
  state.selection.selectedObjectIds = [];
  state.interaction.previousRun = null;
  state.interaction.routeCommittedCount = 0;
  state.interaction.phase = "idle";
}

function pointAt(angle, radius = 120) {
  const radians = (angle * Math.PI) / 180;
  return { x: 100 + radius * Math.cos(radians), y: radius * Math.sin(radians) };
}

[30, 45, 60, 90, 120, 135].forEach((angle) => {
  reset();

  const a = pipe.createPipeDuct({ x: 0, y: 0 }, { x: 100, y: 0 });
  const b = pipe.createPipeDuct(pointAt(angle), { x: 100, y: 0 });

  state.objects = [a, b];

  const inDir = pipe.directionOf(a.geometry.start, a.geometry.end);
  const outDir = pipe.directionOf(b.geometry.start, b.geometry.end);

  tool.connectPipeEndpoints(b);

  const elbow = state.objects.find((o) => o.type === "elbow");
  const c = pipe.elbowCurvesFor(elbow);

  const rS = pipe.directionOf(c.centre, c.start);
  const rE = pipe.directionOf(c.centre, c.end);

  const d = (u, v) => Math.abs(u.x * v.x + u.y * v.y);

  console.log(
    String(angle).padStart(3).padEnd(5),
    "start:",
    d(rS, inDir).toExponential(1).padStart(9),
    "end:",
    d(rE, outDir).toExponential(1).padStart(9),
    "| prev",
    JSON.stringify(elbow.geometry.previous),
    "next",
    JSON.stringify(elbow.geometry.next),
  );
});

process.exit(0);

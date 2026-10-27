const { bootApp } = require("./tests/helpers/boot-app.cjs");
const { locate } = require("./tests/helpers/source-path.cjs");

bootApp();

const tool = require(locate("pipe-duct-tool.js"));
const pipe = require(locate("model/fluids/pipe-duct.js")).default;
const schema = require(locate("feature-schema.js"));
const state = require(locate("editor-state.js")).drawingState;

/* Wire the pipes-follow-the-radius operation, exactly as the panel does. */
schema.setElbowReseat((elbow) => tool.reseatElbowPipes(elbow, state.objects));

function reset() {
  state.objects = [];
  state.selection.selectedObjectIds = [];
}

/* Two pipes joined by an elbow, made the automatic way. */
function build() {
  reset();

  const a = pipe.createPipeDuct({ x: 0, y: 0 }, { x: 100, y: 0 });
  const b = pipe.createPipeDuct({ x: 300, y: 150 }, { x: 100, y: 0 });
  state.objects = [a, b];

  tool.connectPipeEndpoints(b);

  return { a, b, elbow: state.objects.find((o) => o.type === "elbow") };
}

function report(label, { a, b, elbow }) {
  const curves = pipe.elbowCurvesFor(elbow);

  const gapA = curves ? Math.hypot(curves.start.x - a.geometry.end.x, curves.start.y - a.geometry.end.y) : NaN;
  const gapB = curves ? Math.hypot(curves.end.x - b.geometry.end.x, curves.end.y - b.geometry.end.y) : NaN;

  console.log(
    label.padEnd(22),
    "radius", String(elbow.engineering.bendRadius).padStart(7),
    "| arc-start to pipe-A end:", gapA.toFixed(3).padStart(8),
    "| arc-end to pipe-B end:", gapB.toFixed(3).padStart(8),
    "| conns:", JSON.stringify(elbow.engineering.connections)
  );
}

let scene = build();
report("initial", scene);

schema.adjustElbowRadius(scene.elbow, 20);
report("radius +20", scene);

schema.adjustElbowRadius(scene.elbow, -10);
report("radius -10", scene);

process.exit(0);

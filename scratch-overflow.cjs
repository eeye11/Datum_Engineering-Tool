const { bootApp } = require("./tests/helpers/boot-app.cjs");
const { locate } = require("./tests/helpers/source-path.cjs");

bootApp();

const tool = require(locate("pipe-duct-tool.js"));
const pipe = require(locate("model/fluids/pipe-duct.js")).default;
const schema = require(locate("feature-schema.js"));
const state = require(locate("editor-state.js")).drawingState;

schema.setElbowReseat((elbow) => tool.reseatElbowPipes(elbow, state.objects));

state.objects = [];

const a = pipe.createPipeDuct({ x: 0, y: 0 }, { x: 100, y: 0 });
const b = pipe.createPipeDuct({ x: 300, y: 150 }, { x: 100, y: 0 });
state.objects = [a, b];

tool.connectPipeEndpoints(b);

const elbow = state.objects.find((o) => o.type === "elbow");

/* Far beyond what the short pipes can hold. */
for (const change of [50, 100, 500]) {
  const result = schema.adjustElbowRadius(elbow, change);

  console.log(
    `change ${String(change).padStart(3)} -> applied:`,
    Boolean(result),
    "| radius:",
    elbow.engineering.bendRadius.toFixed(2),
    "| fit limit:",
    pipe.elbowFitRadius(elbow)?.toFixed(2),
    "| a length:",
    Math.hypot(
      a.geometry.end.x - a.geometry.start.x,
      a.geometry.end.y - a.geometry.start.y,
    ).toFixed(2),
    "| b length:",
    Math.hypot(
      b.geometry.end.x - b.geometry.start.x,
      b.geometry.end.y - b.geometry.start.y,
    ).toFixed(2),
  );

  const c = pipe.elbowCurvesFor(elbow);

  if (c) {
    const gap = Math.hypot(
      c.start.x - a.geometry.end.x,
      c.start.y - a.geometry.end.y,
    );
    console.log(
      "   gap:",
      gap.toFixed(4),
      "| connections:",
      JSON.stringify(elbow.engineering.connections),
    );
  }
}

process.exit(0);

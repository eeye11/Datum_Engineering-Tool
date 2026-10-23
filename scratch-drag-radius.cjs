const { bootApp } = require("./tests/helpers/boot-app.cjs");
const { locate } = require("./tests/helpers/source-path.cjs");

bootApp();

const tool = require(locate("pipe-duct-tool.js"));
const pipe = require(locate("model/fluids/pipe-duct.js")).default;
const handles = require(locate("handles.js"));
const state = require(locate("editor-state.js")).drawingState;

state.objects = [];

const a = pipe.createPipeDuct({ x: 0, y: 0 }, { x: 100, y: 0 });
const b = pipe.createPipeDuct({ x: 300, y: 150 }, { x: 100, y: 0 });
state.objects = [a, b];

tool.connectPipeEndpoints(b);

const elbow = state.objects.find((o) => o.type === "elbow");

function radiusHandle() {
  return handles
    .editableHandlesFor(elbow)
    .find((h) => h.kind === "elbow-radius");
}

function gap() {
  const c = pipe.elbowCurvesFor(elbow);
  return {
    a: Math.hypot(c.start.x - a.geometry.end.x, c.start.y - a.geometry.end.y),
    b: Math.hypot(c.end.x - b.geometry.end.x, c.end.y - b.geometry.end.y),
  };
}

console.log(
  "initial radius:",
  elbow.engineering.bendRadius,
  "handle:",
  JSON.stringify(radiusHandle().point),
);

/*
 * Simulate dragging the radius handle OUTWARD by a few steps along the radius
 * from the bend centre - the way a student would pull it.
 */
const c0 = pipe.elbowCurvesFor(elbow);
const centre = { ...c0.centre };
const start = radiusHandle().point;

for (let step = 1; step <= 6; step += 1) {
  const dir = pipe.directionOf(centre, start);
  const pull = 3 * step;

  const point = { x: start.x + dir.x * pull, y: start.y + dir.y * pull };

  /* What the drag handler does. */
  const curves = pipe.elbowCurvesFor(elbow);
  const current = Number(elbow.engineering.bendRadius) || curves.radius;
  const sep = Number(elbow.engineering.startSeparation) || 4;

  const target = Math.max(
    0.25,
    Math.hypot(point.x - curves.centre.x, point.y - curves.centre.y) - sep / 2,
  );

  const adjusted = pipe.adjustedBendRadius(elbow, target - current);

  if (adjusted) {
    pipe.setBendRadius(elbow, adjusted.radius);
    tool.reseatElbowPipes(elbow, state.objects);
  }

  const g = gap();

  console.log(
    `  step ${step} pull ${pull}: radius ${elbow.engineering.bendRadius.toFixed(2)}`,
    "| gaps",
    g.a.toFixed(4),
    g.b.toFixed(4),
    "| handle now",
    JSON.stringify(radiusHandle().point),
  );
}

process.exit(0);

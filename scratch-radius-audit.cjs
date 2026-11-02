const { bootApp } = require("./tests/helpers/boot-app.cjs");
const { locate } = require("./tests/helpers/source-path.cjs");

bootApp();

const tool = require(locate("pipe-duct-tool.js"));
const pipe = require(locate("model/fluids/pipe-duct.js")).default;
const schema = require(locate("feature-schema.js"));
const state = require(locate("editor-state.js")).drawingState;

schema.setElbowReseat((elbow) => tool.reseatElbowPipes(elbow, state.objects));

[30, 45, 60, 90, 120, 135].forEach((angle) => {
  state.objects = [];

  const radians = (angle * Math.PI) / 180;
  const far = { x: 100 + 120 * Math.cos(radians), y: 120 * Math.sin(radians) };

  const a = pipe.createPipeDuct({ x: 0, y: 0 }, { x: 100, y: 0 });
  const b = pipe.createPipeDuct(far, { x: 100, y: 0 });
  state.objects = [a, b];

  tool.connectPipeEndpoints(b);

  const elbow = state.objects.find((o) => o.type === "elbow");
  const outerA = { ...a.geometry.start };
  const outerB = { ...b.geometry.start };

  let worstGap = 0;
  let worstTangent = 0;

  for (const change of [20, -5, 15, -25]) {
    schema.adjustElbowRadius(elbow, change);

    const curves = pipe.elbowCurvesFor(elbow);

    const gapA = Math.hypot(
      curves.start.x - a.geometry.end.x,
      curves.start.y - a.geometry.end.y,
    );
    const gapB = Math.hypot(
      curves.end.x - b.geometry.end.x,
      curves.end.y - b.geometry.end.y,
    );

    worstGap = Math.max(worstGap, gapA, gapB);

    /* Tangency at the pipes' own directions. */
    const dA = pipe.directionOf(a.geometry.start, a.geometry.end);
    const dB = pipe.directionOf(b.geometry.start, b.geometry.end);

    const rS = pipe.directionOf(curves.centre, curves.start);
    const rE = pipe.directionOf(curves.centre, curves.end);

    worstTangent = Math.max(
      worstTangent,
      Math.abs(rS.x * dA.x + rS.y * dA.y),
      Math.abs(rE.x * dB.x + rE.y * dB.y),
    );
  }

  const outerMoved =
    Math.hypot(outerA.x - a.geometry.start.x, outerA.y - a.geometry.start.y) +
    Math.hypot(outerB.x - b.geometry.start.x, outerB.y - b.geometry.start.y);

  console.log(
    String(angle).padStart(3),
    "| worst gap:",
    worstGap.toExponential(1),
    "| worst tangency err:",
    worstTangent.toExponential(1),
    "| outer endpoints moved:",
    outerMoved.toExponential(1),
    "| radius:",
    elbow.engineering.bendRadius,
  );
});

process.exit(0);

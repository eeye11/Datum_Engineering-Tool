const { bootApp } = require("./tests/helpers/boot-app.cjs");
const { locate } = require("./tests/helpers/source-path.cjs");

bootApp();

const pipe = require(locate("model/fluids/pipe-duct.js")).default;

/*
 * A genuine elbow: A runs 0..100 on x, B starts at (100,0) and runs away.
 * before = A.start (0,0), vertex = (100,0), after = B.end.
 */
const cases = [
  ["90 deg", { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }],
  ["30 deg", { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 57.7 }],
  ["collinear", { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 0 }],
  [
    "B detached (far end elsewhere)",
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 400, y: 400 },
  ],
];

cases.forEach(([label, before, vertex, after]) => {
  const a = { x: before.x - vertex.x, y: before.y - vertex.y };
  const b = { x: after.x - vertex.x, y: after.y - vertex.y };
  const dot = a.x * b.x + a.y * b.y;
  const angle = pipe.cornerAngleDegrees(before, vertex, after);

  console.log(
    label.padEnd(32),
    "dot",
    dot.toFixed(1).padStart(9),
    "| angle",
    angle === null ? "null" : angle.toFixed(1),
  );
});

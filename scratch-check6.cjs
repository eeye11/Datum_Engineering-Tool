const { bootApp } = require("./tests/helpers/boot-app.cjs");
const { locate } = require("./tests/helpers/source-path.cjs");

const page = bootApp();

if (page.error) {
  console.error(page.error);
  process.exit(1);
}

const model = require(locate("source-model.js"));

const shapes = [
  model.shapeFromStatement(
    "\\draw[draw=black] (50,38.6863) ++(135:10) arc[start angle=135, delta angle=-90, radius=10];",
  ),
  model.shapeFromStatement(
    "\\draw[draw=black] (50,38.6863) ++(135:6) arc[start angle=135, delta angle=-90, radius=6];",
  ),
];

console.log(shapes.map((shape) => shape && shape.type));

/* Mirror of the fit's decisions. */
const [a, b] = shapes.map((shape) => ({
  centre: shape.centre,
  radius: shape.radius,
  startAngle: shape.startAngle,
  endAngle: shape.startAngle + shape.deltaAngle,
}));

console.log("centres", a.centre, b.centre);
console.log("sweeps", a.endAngle - a.startAngle, b.endAngle - b.startAngle);

const signedSweep = a.endAngle - a.startAngle;
const radius = (a.radius + b.radius) / 2;

console.log("radius", radius, "signedSweep", signedSweep);

process.exit(0);

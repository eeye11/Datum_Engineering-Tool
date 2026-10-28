const { bootApp } = require("./tests/helpers/boot-app.cjs");
const { locate } = require("./tests/helpers/source-path.cjs");

const page = bootApp();

if (page.error) {
  console.error(page.error);
  process.exit(1);
}

const model = require(locate("source-model.js"));

const a = model.shapeFromStatement(
  "\\draw[draw=black] (50,38.6863) ++(135:10) arc[start angle=135, delta angle=-90, radius=10];",
);

console.log("arc shape", a, JSON.stringify(a));

/* The fit, re-implemented here so its decisions are visible. */
const delta = a.deltaAngle;
const start = a.startAngle;
const end = start + delta;

console.log("start", start, "delta", delta, "end", end);

process.exit(0);

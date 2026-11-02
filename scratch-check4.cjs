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
const b = model.shapeFromStatement(
  "\\draw[draw=black] (50,38.6863) ++(135:6) arc[start angle=135, delta angle=-90, radius=6];",
);

console.log(a, b);

process.exit(0);

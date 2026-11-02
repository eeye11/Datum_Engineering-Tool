const { bootApp } = require("./tests/helpers/boot-app.cjs");
const { locate } = require("./tests/helpers/source-path.cjs");

bootApp();

const model = require(locate("source-model.js"));

const statement =
  "\\draw[draw=black, line width=1.2pt] (50,38.6863) ++(135:10) arc[start angle=135, delta angle=-90, radius=10];";

console.log(
  JSON.stringify(
    model.pathOperations(statement.slice(34).replace(/;\s*$/, "")),
  ),
);
console.log(JSON.stringify(model.shapeFromStatement(statement)));

process.exit(0);

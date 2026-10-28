const { bootApp } = require("./tests/helpers/boot-app.cjs");
const { locate } = require("./tests/helpers/source-path.cjs");

const page = bootApp();

if (page.error) {
  console.error(page.error);
  process.exit(1);
}

const model = require(locate("source-model.js"));
const drawingSource = require(locate("drawing-source.js"));
const sync = require(locate("source-object-sync.js"));

const source = [
  "% DAETUM OBJECT: Elbow",
  "% DAETUM ID: elbow-1",
  "% DAETUM TYPE: elbow",
  "\\draw[draw=black] (50,38.6863) ++(135:10) arc[start angle=135, delta angle=-90, radius=10];",
  "\\draw[draw=black] (50,38.6863) ++(135:6) arc[start angle=135, delta angle=-90, radius=6];",
].join("\n");

const map = drawingSource.createSourceMap(source);

console.log("blocks", map.blocks);

const statement = source.split("\n")[3];

console.log("parsed", model.shapeFromStatement(statement));

console.log(
  "report",
  JSON.stringify(
    sync.readSourceIntoModel({
      source,
      map,
      objects: [],
      isEditing: () => false,
    }),
    null,
    1,
  ).slice(0, 1500),
);

process.exit(0);

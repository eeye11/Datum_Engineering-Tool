const { bootApp } = require("./tests/helpers/boot-app.cjs");
const { locate } = require("./tests/helpers/source-path.cjs");

bootApp();

const tool = require(locate("pipe-duct-tool.js"));
const sync = require(locate("source-synchronization.js"));
const apply = require(locate("source-model-apply.js"));
const model = require(locate("drawing-state.js")).default;
const sourceModel = require(locate("source-model.js"));
const sourceSync = require(locate("source-object-sync.js"));
const drawingSource = require(locate("drawing-source.js"));
const state = require(locate("editor-state.js")).drawingState;

state.objects = [];

const { elbow } = tool.commitElbowGesture({ x: 0, y: 0 }, { x: 100, y: 0 });

const source = sync.sourceForObject(elbow);

console.log("--- source ---");
console.log(source);

const map = drawingSource.createSourceMap(source);

console.log("--- blocks ---");
console.log(JSON.stringify(map.blocks));

console.log("--- shapes ---");
source
  .split("\n")
  .filter((line) => line.trim().startsWith("\\draw"))
  .forEach((line) =>
    console.log(JSON.stringify(sourceModel.shapeFromStatement(line))),
  );

console.log("--- direct read ---");
console.log(
  JSON.stringify(
    sourceSync.readSourceIntoModel({
      source,
      map,
      objects: [elbow],
      isEditing: () => false,
    }),
  ),
);

console.log("--- apply ---");
state.objects = [elbow];
const edited = source.replace(
  /radius=([\d.]+)/g,
  (match, value) => `radius=${Number(value) + 2}`,
);
console.log(
  JSON.stringify(
    apply.applyParsedSourceToDrawing({ model, state, source: edited }),
  ),
);

process.exit(0);

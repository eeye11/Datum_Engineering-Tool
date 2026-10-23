const { bootApp } = require("./tests/helpers/boot-app.cjs");
const { locate } = require("./tests/helpers/source-path.cjs");

bootApp();

const tool = require(locate("pipe-duct-tool.js"));
const sync = require(locate("source-synchronization.js"));
const apply = require(locate("source-model-apply.js"));
const model = require(locate("drawing-state.js")).default;
const state = require(locate("editor-state.js")).drawingState;

state.objects = [];

const { elbow } = tool.commitElbowGesture({ x: 0, y: 0 }, { x: 100, y: 0 });
const source = sync.sourceForObject(elbow);

const edited = source.replace(
  /radius=([\d.]+)/g,
  (match, value) => `radius=${Number(value) + 2}`,
);

console.log(
  "edited radius line",
  edited.split("\n").find((line) => line.includes("radius=")),
);

state.objects = [elbow];

const report = apply.applyParsedSourceToDrawing({
  model,
  state,
  source: edited,
});

console.log("report", JSON.stringify(report));
console.log("bendRadius", elbow.engineering.bendRadius);

process.exit(0);

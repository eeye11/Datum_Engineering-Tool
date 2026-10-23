const { bootApp } = require("./tests/helpers/boot-app.cjs");
const { locate } = require("./tests/helpers/source-path.cjs");

bootApp();

const tool = require(locate("pipe-duct-tool.js"));
const state = require(locate("editor-state.js")).drawingState;
const selection = require(locate("selection-transform.js"));
const pipe = require(locate("model/fluids/pipe-duct.js")).default;

state.objects = [];
state.selection.selectedObjectIds = [];

const { elbow } = tool.commitElbowGesture({ x: 0, y: 0 }, { x: 80, y: 80 });

console.log("geometry", JSON.stringify(elbow.geometry));
console.log(
  "bounds",
  JSON.stringify(selection.selectionBounds([elbow], [elbow.id])),
);

/* The A5 case: two pipe ends. */
state.objects = [];
const first = pipe.createPipeDuct({ x: 0, y: 0 }, { x: 100, y: 0 });
const second = pipe.createPipeDuct({ x: 200, y: 100 }, { x: 200, y: 0 });
state.objects = [first, second];

const connected = tool.commitElbowGesture({ x: 100, y: 0 }, { x: 200, y: 0 });

console.log("connected geometry", JSON.stringify(connected.elbow.geometry));
console.log(
  "connected engineering",
  JSON.stringify(connected.elbow.engineering),
);

/* B2's partial case. */
console.log("---- partial ----");
state.objects = [];
const run = pipe.createPipeDuct({ x: 200, y: 0 }, { x: 300, y: 0 });
state.objects.push(run);

const partial = tool.commitElbowGesture({ x: 200, y: 0 }, { x: 200, y: -80 });

console.log("partial", JSON.stringify(partial && partial.elbow.geometry));
console.log("state", JSON.stringify(tool.pipeEndAt({ x: 200, y: 0 })));

process.exit(0);

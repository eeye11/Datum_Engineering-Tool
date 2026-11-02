const { bootApp } = require("./tests/helpers/boot-app.cjs");
const { locate } = require("./tests/helpers/source-path.cjs");

bootApp();

const tool = require(locate("pipe-duct-tool.js"));
const pipe = require(locate("model/fluids/pipe-duct.js")).default;
const state = require(locate("editor-state.js")).drawingState;

const dirs = [
  [30, { x: 203.92, y: 60 }],
  [45, { x: 184.85, y: 84.85 }],
  [90, { x: 100, y: 120 }],
];

dirs.forEach(([angle, far]) => {
  state.objects = [];

  const a = pipe.createPipeDuct({ x: 0, y: 0 }, { x: 100, y: 0 });
  const b = pipe.createPipeDuct(far, { x: 100, y: 0 });
  state.objects = [a, b];

  const made = tool.generateElbowFor(a, b, pipe.defaultPipeEngineering());
  console.log(`\n${angle}: made?`, Boolean(made));
  if (made) {
    console.log(
      "  geometry.prev:",
      JSON.stringify(made.geometry.previous),
      "next:",
      JSON.stringify(made.geometry.next),
      "pos:",
      JSON.stringify(made.geometry.position),
    );
    console.log("  ports:", made.engineering.ports);
  }
});

process.exit(0);

const { bootApp } = require("./tests/helpers/boot-app.cjs");
const { locate } = require("./tests/helpers/source-path.cjs");

bootApp();

const tool = require(locate("pipe-duct-tool.js"));
const pipe = require(locate("model/fluids/pipe-duct.js")).default;
const state = require(locate("editor-state.js")).drawingState;

const radians = (30 * Math.PI) / 180;
const far = { x: 100 + 120 * Math.cos(radians), y: 120 * Math.sin(radians) };

state.objects = [];

const a = pipe.createPipeDuct({ x: 0, y: 0 }, { x: 100, y: 0 });
const b = pipe.createPipeDuct(far, { x: 100, y: 0 });
state.objects = [a, b];

const made = tool.connectPipeEndpoints(b)[0];

console.log("right after connectPipeEndpoints:");
console.log("  geometry:", JSON.stringify(made.geometry));
console.log("  ports:", JSON.stringify(made.engineering.ports));

const corner = tool.cornerOf(made, state.objects);
console.log("\ncornerOf now:", JSON.stringify(corner));

/* Apply the refresh the way a drag would. */
tool.refreshFluidConnections(b, state.objects);
console.log("\nafter refreshFluidConnections:");
console.log("  geometry:", JSON.stringify(made.geometry));
console.log(
  "  exists:",
  state.objects.some((o) => o.id === made.id),
);

process.exit(0);

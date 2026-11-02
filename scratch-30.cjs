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

console.log("a.id:", a.id, "b.id:", b.id, "a<b:", a.id < b.id);

/* Which order does connectPipeEndpoints use? */
const [first, second] = a.id < b.id ? [a, b] : [b, a];
console.log("first is a?", first.id === a.id);

const joint = tool.joiningCornerOf(first, second);
console.log("joiningCornerOf(first, second):", JSON.stringify(joint));

const made = tool.generateElbowFor(
  first,
  second,
  pipe.defaultPipeEngineering(),
);
console.log(
  "\ngenerateElbowFor -> ports:",
  JSON.stringify(made.engineering.ports),
);
console.log("  connections:", JSON.stringify(made.engineering.connections));
console.log("  geometry:", JSON.stringify(made.geometry));

process.exit(0);

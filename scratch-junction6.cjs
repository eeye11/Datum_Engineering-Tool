const { bootApp } = require("./tests/helpers/boot-app.cjs");
const { locate } = require("./tests/helpers/source-path.cjs");

bootApp();

const tool = require(locate("junction-tool.js"));
const pipe = require(locate("model/fluids/pipe-duct.js")).default;
const j = require(locate("model/fluids/junction.js")).default;
const schema = require(locate("feature-schema.js"));
const state = require(locate("editor-state.js")).drawingState;

state.objects = [];
state.selection.selectedObjectIds = [];

const host = pipe.createPipeDuct({ x: 0, y: 0 }, { x: 200, y: 0 });
const branch = pipe.createPipeDuct({ x: 100, y: 80 }, { x: 100, y: 0 });
state.objects = [host, branch];

/* Give the host a wide pipe. */
schema.writeField(host, "pipeWidth", 12);

const made = tool.createJunctionForInteriorConnection(branch, state.objects);

console.log(
  "branch widths:",
  made.geometry.branches.map((b) => `${b.id}:${b.width}`),
);
console.log("host pipe width (unchanged):", host.engineering.separation);

const outline = j.junctionOutline(made);
const xs = outline.map((p) => p.x);
const ys = outline.map((p) => p.y);
console.log("outline points:", outline.length);
console.log("extent:", [
  Math.min(...xs),
  Math.max(...xs),
  Math.min(...ys),
  Math.max(...ys),
]);

const seen = new Set(outline.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`));
console.log("unique points:", seen.size, "of", outline.length);

setTimeout(() => process.exit(0), 300);

const test = require("node:test");
const { bootApp } = require("./helpers/boot-app.cjs");
const { locate } = require("./helpers/source-path.cjs");

test("debug", () => {
  const page = bootApp();
  if (page.error) throw page.error;

  const tool = require(locate("pipe-duct-tool.js"));
  const pipe = require(locate("model/fluids/pipe-duct.js")).default;
  const state = require(locate("editor-state.js")).drawingState;

  state.objects = [];

  const a = pipe.createPipeDuct({ x: 0, y: 0 }, { x: 100, y: 0 });
  const b = pipe.createPipeDuct({ x: 300, y: 150 }, { x: 100, y: 0 });
  state.objects = [a, b];

  tool.connectPipeEndpoints(b);

  const elbow = state.objects.find((o) => o.type === "elbow");
  console.log(
    "objects",
    state.objects.map((o) => [o.type, JSON.stringify(o.geometry)]),
  );
  console.log("eng", JSON.stringify(elbow.engineering));
  console.log("corner", JSON.stringify(tool.cornerOf(elbow, state.objects)));

  b.geometry.end = { x: 600, y: 600 };
  console.log("removed", JSON.stringify(tool.reconcileFluidConnections(b)));
  console.log(
    "after",
    state.objects.map((o) => [o.type, JSON.stringify(o.geometry)]),
  );

  b.geometry.end = { x: 100, y: 0 };
  tool.connectPipeEndpoints(b);
  console.log(
    "re",
    state.objects.map((o) => [o.type, JSON.stringify(o.geometry)]),
  );

  setImmediate(() => process.exit(0));
});

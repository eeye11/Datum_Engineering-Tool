const { whenReady } = require("./tests/helpers/boot-app.cjs");
const { locate } = require("./tests/helpers/source-path.cjs");

(async () => {
  await whenReady();
  require(locate("features-editor.js"));

  const state = require(locate("editor-state.js")).drawingState;
  const ds = require(locate("drawing-state.js")).default;
  const V = require(locate("model/fluids/reservoir-tank.js")).default;
  const P = require(locate("model/fluids/pipe-duct.js")).default;
  const tool = require(locate("pipe-duct-tool.js"));

  state.objects = [];
  state.selection.selectedObjectIds = [];

  const v = V.vesselFromDrag({ x: 0, y: 0 }, { x: 40, y: 30 });
  ds.addObject(state, v);
  const c = state.objects.find((o) => o.id === v.id);

  const run = P.createPipeDuct({ x: 80, y: 15 }, { x: 40, y: 15 });
  ds.addObject(state, run);
  const stored = state.objects.find((o) => o.id === run.id);

  console.log("run === stored?", run === stored);
  console.log("ports:", JSON.stringify(P.portsOf(stored)));
  console.log(
    "attachment on end?",
    JSON.stringify(V.outlineAttachment(c, { x: 40, y: 15 }, 1.5)),
  );

  tool.reconcileFluidConnections(run, state.objects);

  console.log(
    "after reconcile, stored.eng:",
    JSON.stringify(stored.engineering),
  );
  console.log("run.eng:", JSON.stringify(run.engineering));

  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

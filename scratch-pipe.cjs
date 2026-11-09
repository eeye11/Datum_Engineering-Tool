const { bootApp, whenReady } = require("./tests/helpers/boot-app.cjs");
const { locate } = require("./tests/helpers/source-path.cjs");

(async () => {
  const page = bootApp();
  if (page.error) throw page.error;
  await whenReady();

  require(locate("features-editor.js"));
  const state = require(locate("editor-state.js")).drawingState;
  const ds = require(locate("drawing-state.js")).default;
  const vessel = require(locate("model/fluids/reservoir-tank.js")).default;
  const pipe = require(locate("model/fluids/pipe-duct.js")).default;
  const pipeTool = require(locate("pipe-duct-tool.js"));
  const schema = require(locate("feature-schema.js"));

  state.objects = [];
  state.selection.selectedObjectIds = [];

  const v = vessel.vesselFromDrag({ x: 0, y: 0 }, { x: 40, y: 30 });
  ds.addObject(state, v);
  const c = state.objects.find((o) => o.id === v.id);
  console.log("vessel rect", JSON.stringify(vessel.vesselRect(c).corners));

  const run = pipe.createPipeDuct({ x: 80, y: 15 }, { x: 40, y: 15 });
  ds.addObject(state, run);
  pipeTool.reconcileFluidConnections(run, state.objects);
  console.log(
    "attached",
    run.engineering?.vesselId === c.id,
    "port",
    run.engineering?.vesselPort,
    "local",
    JSON.stringify(run.engineering?.vesselLocal),
  );
  console.log(
    "level",
    vessel.fluidLevelPercentOf(c),
    "enabled",
    vessel.fluidLevelEnabledOf(c),
  );

  schema.writeField(c, "vesselWidth", 70);
  console.log("after width 70: pipe end", JSON.stringify(run.geometry.end));

  setImmediate(() => process.exit(0));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

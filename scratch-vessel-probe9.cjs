const { bootApp, whenReady } = require("./tests/helpers/boot-app.cjs");
const { locate } = require("./tests/helpers/source-path.cjs");

(async () => {
  const page = bootApp();
  if (page.error) throw page.error;
  await whenReady();

  const state = require(locate("editor-state.js")).drawingState;
  const ds = require(locate("drawing-state.js")).default;
  const vessel = require(locate("model/fluids/reservoir-tank.js")).default;
  const pipe = require(locate("model/fluids/pipe-duct.js")).default;
  const tool = require(locate("pipe-duct-tool.js"));
  const schema = require(locate("feature-schema.js"));

  state.objects = [];
  state.selection.selectedObjectIds = [];

  const v = vessel.vesselFromDrag({ x: 0, y: 0 }, { x: 40, y: 30 });
  ds.addObject(state, v);
  const c = state.objects.find((o) => o.id === v.id);

  const run = pipe.createPipeDuct({ x: 80, y: 15 }, { x: 40, y: 15 });
  ds.addObject(state, run);
  const live = state.objects.find((o) => o.id === run.id);
  tool.reconcileFluidConnections(live, state.objects);
  console.log("attached", live.engineering?.vesselId === c.id);

  schema.writeField(c, "vesselWidth", 70);
  console.log(
    "panel resize -> width",
    c.geometry.width,
    "pipe end",
    JSON.stringify(live.geometry.end),
  );

  // set style open -> top-held pipe on lid should release
  const lidRun = pipe.createPipeDuct({ x: 20, y: 30 }, { x: 20, y: 60 });
  ds.addObject(state, lidRun);
  const lid = state.objects.find((o) => o.id === lidRun.id);
  schema.writeField(c, "vesselStyle", "closed");
  tool.reconcileFluidConnections(lid, state.objects);
  console.log(
    "lid attached to closed tank:",
    lid.engineering?.vesselId === c.id,
  );
  schema.writeField(c, "vesselStyle", "open");
  console.log(
    "lid attached after switching to reservoir:",
    Boolean(lid.engineering?.vesselId),
  );

  setImmediate(() => process.exit(0));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

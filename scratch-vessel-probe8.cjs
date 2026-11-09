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

  state.objects = [];
  state.selection.selectedObjectIds = [];

  const v = vessel.vesselFromDrag({ x: 0, y: 0 }, { x: 40, y: 30 });
  ds.addObject(state, v);
  const c = state.objects.find((o) => o.id === v.id);

  // Pipe ending exactly on the right wall at y=15
  const run = pipe.createPipeDuct({ x: 80, y: 15 }, { x: 40, y: 15 });
  ds.addObject(state, run);
  const live = state.objects.find((o) => o.id === run.id);
  tool.reconcileFluidConnections(live, state.objects);
  console.log(
    "attached to vessel?",
    live.engineering?.vesselId === c.id,
    "port",
    live.engineering?.vesselPort,
    "local",
    JSON.stringify(live.engineering?.vesselLocal),
  );
  console.log(
    "elbows generated:",
    state.objects.filter((o) => o.type === "elbow").length,
  );

  // Resize the vessel; pipe end should follow
  vessel.resizeVessel(c, 80, 60, state.objects);
  console.log("after resize pipe end", JSON.stringify(live.geometry.end));

  // Move the vessel; pipe follows
  c.geometry = { ...c.geometry, position: { x: 10, y: 0 } };
  vessel.followVessel(c, state.objects);
  console.log("after move pipe end", JSON.stringify(live.geometry.end));

  // Pipe crossing (not ending on wall) should not attach
  const crossing = pipe.createPipeDuct({ x: -20, y: 30 }, { x: 60, y: 30 });
  ds.addObject(state, crossing);
  const liveCross = state.objects.find((o) => o.id === crossing.id);
  tool.reconcileFluidConnections(liveCross, state.objects);
  console.log("crossing attached?", Boolean(liveCross.engineering?.vesselId));

  // Elbow not triggered between vessel and pipe: count
  console.log(
    "elbows total:",
    state.objects.filter((o) => o.type === "elbow").length,
  );

  setImmediate(() => process.exit(0));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

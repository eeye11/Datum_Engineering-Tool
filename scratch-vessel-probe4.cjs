const { bootApp, whenReady } = require("./tests/helpers/boot-app.cjs");
const { locate } = require("./tests/helpers/source-path.cjs");

(async () => {
  const page = bootApp();
  if (page.error) throw page.error;
  await whenReady();

  const state = require(locate("editor-state.js")).drawingState;
  const ds = require(locate("drawing-state.js")).default;
  const vessel = require(locate("model/fluids/reservoir-tank.js")).default;
  const schema = require(locate("feature-schema.js"));

  state.objects = [];
  state.selection.selectedObjectIds = [];

  const v = vessel.vesselFromDrag({ x: 10, y: 10 }, { x: -30, y: -20 });
  ds.addObject(state, v);
  const c = state.objects.find((o) => o.id === v.id);
  schema.writeField(c, "vesselStyle", "closed");
  schema.writeField(c, "vesselFluidEnabled", true);
  schema.writeField(c, "vesselFluidPercent", 25);

  console.log(
    "before",
    JSON.stringify(c.geometry),
    JSON.stringify(vessel.fluidLevelSegment(c)),
  );
  console.log("write height", schema.writeField(c, "vesselHeight", 60));
  console.log(
    "after",
    JSON.stringify(c.geometry),
    JSON.stringify(vessel.fluidLevelSegment(c)),
  );
  console.log(
    "percent",
    vessel.fluidLevelPercentOf(c),
    JSON.stringify(c.engineering),
  );

  setImmediate(() => process.exit(0));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

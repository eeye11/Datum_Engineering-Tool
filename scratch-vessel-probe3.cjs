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

  for (const h of [30, 45, 60]) {
    console.log(
      "--- set height",
      h,
      "write:",
      schema.writeField(c, "vesselHeight", h),
    );
    const rect = vessel.vesselRect(c);
    console.log("  geom", JSON.stringify(c.geometry));
    console.log("  corners", JSON.stringify(rect.corners));
    console.log("  seg", JSON.stringify(vessel.fluidLevelSegment(c)));
    console.log(
      "  exported interiorSpan",
      JSON.stringify(vessel.interiorSpan(c, 0.25 * rect.height, 1.5)),
    );
  }

  setImmediate(() => process.exit(0));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

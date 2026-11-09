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

  const v = vessel.vesselFromDrag({ x: 0, y: 0 }, { x: 40, y: 40 });
  ds.addObject(state, v);
  const c = state.objects.find((o) => o.id === v.id);
  schema.writeField(c, "vesselStyle", "closed");
  schema.writeField(c, "vesselFluidEnabled", true);
  schema.writeField(c, "vesselFluidPercent", 25);

  const rect = vessel.vesselRect(c);
  console.log(
    "rect position",
    JSON.stringify(rect.position),
    "height",
    rect.height,
  );
  console.log(
    "corners (model order: 0 TL, 1 TR, 2 BR, 3 BL):",
    JSON.stringify(rect.corners.map((p) => ({ x: p.x, y: p.y }))),
  );
  console.log("segments:");
  vessel
    .vesselSegments(c)
    .forEach((s) =>
      console.log("  ", JSON.stringify(s.start), "->", JSON.stringify(s.end)),
    );
  console.log("surface (25%):", JSON.stringify(vessel.fluidLevelSegment(c)));
  console.log("region:", JSON.stringify(vessel.fluidLevelRegion(c).points));
  console.log("expected surface y (25% of internal height) =", 40 * 0.25);

  setImmediate(() => process.exit(0));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

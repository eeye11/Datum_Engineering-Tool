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

  const v = vessel.vesselFromDrag({ x: 0, y: 0 }, { x: 40, y: 30 });
  ds.addObject(state, v);
  const c = state.objects.find((o) => o.id === v.id);
  schema.writeField(c, "vesselStyle", "closed");

  c.engineering = { ...c.engineering };
  console.log(
    "style",
    vessel.vesselStyleOf(c),
    "rect",
    JSON.stringify(vessel.vesselRect(c)),
  );

  const segs = vessel.vesselSegments(c);
  console.log("segments", segs.length, JSON.stringify(segs));

  const lid = {
    id: "run1",
    type: "pipe-duct",
    engineering: {
      vesselId: c.id,
      vesselPort: "start",
      vesselLocal: { x: 20, y: 30 },
    },
    geometry: { start: { x: 20, y: 30 }, end: { x: 20, y: 60 } },
  };
  const list = [c, lid];
  vessel.followVessel(c, list);
  console.log(
    "lid engineering after follow (still closed)",
    JSON.stringify(lid.engineering),
  );

  schema.writeField(c, "vesselStyle", "open");
  console.log("style now", vessel.vesselStyleOf(c));
  console.log("lid engineering after switch", JSON.stringify(lid.engineering));

  setImmediate(() => process.exit(0));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

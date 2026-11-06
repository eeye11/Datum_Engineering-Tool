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
  const v = vessel.vesselFromDrag({ x: 0, y: 0 }, { x: 40, y: 30 });
  ds.addObject(state, v);
  const c = state.objects.find((o) => o.id === v.id);
  schema.writeField(c, "vesselStyle", "closed");

  const lid = {
    id: "run1",
    type: "pipe-duct",
    engineering: {
      vesselId: c.id,
      vesselPort: "start",
      vesselLocal: { x: 20, y: 0 },
    },
    geometry: { start: { x: 20, y: 0 }, end: { x: 20, y: 40 } },
  };
  const list = [c, lid];

  schema.writeField(c, "vesselStyle", "open");
  console.log("lid after switch:", JSON.stringify(lid.engineering));

  setImmediate(() => process.exit(0));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

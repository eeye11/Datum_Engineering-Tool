const { bootApp, whenReady } = require("./tests/helpers/boot-app.cjs");
const { locate } = require("./tests/helpers/source-path.cjs");

(async () => {
  await whenReady();
  require(locate("features-editor.js"));
  const state = require(locate("editor-state.js")).drawingState;
  const V = require(locate("model/fluids/reservoir-tank.js")).default;
  const schema = require(locate("feature-schema.js"));

  const v = V.vesselFromDrag({ x: 0, y: 0 }, { x: 40, y: 30 });
  const run = {
    id: "run1",
    type: "pipe-duct",
    geometry: { start: { x: 80, y: 15 }, end: { x: 40, y: 15 } },
    engineering: {
      vesselId: v.id,
      vesselPort: "end",
      vesselLocal: { x: 40, y: 15 },
    },
  };
  state.objects = [v, run];

  console.log("write width 70 ->", schema.writeField(v, "vesselWidth", 70));
  console.log(
    "pipe end",
    JSON.stringify(run.geometry.end),
    "rect",
    JSON.stringify(V.vesselRect(v).width),
  );

  setImmediate(() => process.exit(0));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

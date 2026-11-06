const { bootApp, whenReady } = require("./tests/helpers/boot-app.cjs");
const { locate } = require("./tests/helpers/source-path.cjs");

(async () => {
  await whenReady();
  require(locate("features-editor.js"));
  const state = require(locate("editor-state.js")).drawingState;
  const V = require(locate("model/fluids/reservoir-tank.js")).default;

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

  console.log(
    "vessel id",
    v.id,
    "run.vesselId",
    run.engineering.vesselId,
    "match",
    v.id === run.engineering.vesselId,
  );
  console.log("style", V.vesselStyleOf(v));
  const rect = V.vesselRect(v);
  console.log(
    "rect",
    JSON.stringify({ p: rect.position, w: rect.width, h: rect.height }),
  );
  console.log(
    "local.y",
    run.engineering.vesselLocal.y,
    "lid?",
    run.engineering.vesselLocal.y >= rect.height - 1e-6,
  );
  console.log("worldOf", JSON.stringify(V.worldOf(rect, { x: 40, y: 15 })));

  setImmediate(() => process.exit(0));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

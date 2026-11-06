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

  const rect = V.vesselRect(v);
  console.log("rect height", rect.height, "width", rect.width);
  console.log("local.y", run.engineering.vesselLocal.y);
  console.log("lid test", run.engineering.vesselLocal.y >= rect.height - 1e-6);

  const before = JSON.stringify(run.geometry.end);
  const ok = V.followVessel(v, [v, run]);
  console.log(
    "follow",
    ok,
    "before",
    before,
    "after",
    JSON.stringify(run.geometry.end),
  );

  setImmediate(() => process.exit(0));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

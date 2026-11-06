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

  const follow = V.followVessel;
  V.followVessel = function (vessel, objects) {
    const rect = V.vesselRect(vessel);
    console.log(
      "  followVessel: rect h",
      rect && rect.height,
      "list",
      objects ? objects.length : "null",
    );
    if (objects && objects[1]) {
      console.log(
        "  entry engineering keys",
        Object.keys(objects[1].engineering || {}).join(","),
      );
    }
    const r = follow.apply(this, arguments);
    console.log(
      "  followVessel returned",
      r,
      "pipe end now",
      JSON.stringify(run.geometry.end),
    );
    return r;
  };

  V.resizeVessel(v, 70, 30);
  console.log("final pipe end", JSON.stringify(run.geometry.end));

  setImmediate(() => process.exit(0));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

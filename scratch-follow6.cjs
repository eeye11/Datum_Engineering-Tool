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

  const list = V.vesselObjectList();
  console.log(
    "list[0] is v?",
    list[0] === v,
    "| list[1] is run?",
    list[1] === run,
  );
  console.log(
    "list length",
    list.length,
    "ids",
    list.map((o) => o.id).join(","),
  );
  console.log("run in list?", list.includes(run));

  const rect = V.vesselRect(v);
  const entry = list.find((o) => o.id === "run1");
  console.log(
    "entry vesselId",
    entry.engineering.vesselId,
    "port",
    entry.engineering.vesselPort,
  );
  console.log("id equal?", entry.engineering.vesselId === v.id);

  setImmediate(() => process.exit(0));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

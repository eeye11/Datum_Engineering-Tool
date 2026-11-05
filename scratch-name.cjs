const { bootApp, whenReady } = require("./tests/helpers/boot-app.cjs");
const { locate } = require("./tests/helpers/source-path.cjs");

(async () => {
  await whenReady();
  require(locate("features-editor.js"));

  const state = require(locate("editor-state.js")).drawingState;
  const ds = require(locate("drawing-state.js")).default;
  const V = require(locate("model/fluids/reservoir-tank.js")).default;
  const sync = require(locate("source-synchronization.js"));
  const mapping = require(locate("source-mapping.js"));
  const apply = require(locate("source-model-apply.js"));

  state.objects = [];
  const v = V.vesselFromDrag({ x: 0, y: 0 }, { x: 40, y: 30 });
  ds.addObject(state, v);
  const c = state.objects.find((o) => o.id === v.id);
  c.name = "Day Tank";

  const block = sync.sourceForObject(c);
  const src = [
    "\\begin{tikzpicture}[x=1mm,y=1mm]",
    block,
    "\\end{tikzpicture}",
  ].join("\n");

  const blocks = [];

  blocks.forEach((b) =>
    console.log(
      "block id:",
      b.id,
      "| name:",
      JSON.stringify(b.name),
      "| type:",
      b.type,
    ),
  );

  state.objects = [];
  const report = apply.applyParsedSourceToDrawing({
    model: ds,
    state,
    source: src,
    editable: true,
    removeMissing: false,
  });

  console.log("created:", report.created, "updated:", report.updated);
  state.objects.forEach((o) =>
    console.log("object:", o.type, "| name:", JSON.stringify(o.name)),
  );

  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

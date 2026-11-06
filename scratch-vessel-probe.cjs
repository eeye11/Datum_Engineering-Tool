const { bootApp, whenReady } = require("./tests/helpers/boot-app.cjs");
const { locate } = require("./tests/helpers/source-path.cjs");

(async () => {
  const page = bootApp();
  if (page.error) throw page.error;
  await whenReady();

  const state = require(locate("editor-state.js")).drawingState;
  const ds = require(locate("drawing-state.js")).default;
  const vessel = require(locate("model/fluids/reservoir-tank.js")).default;
  const level = require(locate("model/fluids/fluid-level.js")).default;
  const schema = require(locate("feature-schema.js"));
  const sync = require(locate("source-synchronization.js"));
  const apply = require(locate("source-model-apply.js"));
  const handles = require(locate("handles.js"));

  state.objects = [];
  state.selection.selectedObjectIds = [];

  // Drag in all directions
  const directions = [
    [
      { x: 0, y: 0 },
      { x: 40, y: 30 },
    ],
    [
      { x: 40, y: 30 },
      { x: 0, y: 0 },
    ],
    [
      { x: 40, y: 0 },
      { x: 0, y: 30 },
    ],
    [
      { x: 0, y: 30 },
      { x: 40, y: 0 },
    ],
  ];
  for (const [a, b] of directions) {
    const v = vessel.vesselFromDrag(a, b);
    console.log(
      "drag",
      JSON.stringify(a),
      JSON.stringify(b),
      "->",
      v ? JSON.stringify(v.geometry) : null,
    );
  }

  const v = vessel.vesselFromDrag({ x: 0, y: 0 }, { x: 40, y: 30 });
  ds.addObject(state, v);
  const committed = state.objects.find((o) => o.id === v.id);
  console.log(
    "name",
    committed.name,
    "type",
    committed.type,
    "style",
    JSON.stringify(committed.style),
  );

  // source
  const block = sync.sourceForObject(committed);
  console.log("--- SOURCE ---\n" + block + "\n--- END ---");

  // change to closed, resize through source
  const edited = block
    .replace("style=open", "style=closed")
    .replace("width=40", "width=55");
  const source = `\\begin{tikzpicture}[x=1mm, y=1mm]\n${edited}\n\\end{tikzpicture}`;
  const report = apply.applyParsedSourceToDrawing({
    model: ds,
    state,
    source,
    editable: true,
    removeMissing: false,
  });
  console.log(
    "report",
    JSON.stringify({
      created: report.created,
      updated: report.updated,
      removed: report.removed,
    }),
  );
  const reread = state.objects.find((o) => o.id === v.id);
  console.log(
    "reread geom",
    JSON.stringify(reread.geometry),
    "style",
    vessel.vesselStyleOf(reread),
  );

  // handles
  console.log(
    "handles",
    JSON.stringify(
      handles
        .editableHandlesFor(reread)
        .map((h) => ({ kind: h.kind, x: h.point?.x, y: h.point?.y })),
    ),
  );

  // schema groups
  console.log(
    "groups",
    JSON.stringify(
      schema
        .groupsFor(reread)
        .map((g) => ({ id: g.id, fields: g.fields.map((f) => f.key) })),
    ),
  );

  // fluid level via the vessel object? none yet
  const lv = level.createFluidLevel(reread, 50);
  ds.addObject(state, lv);
  console.log(
    "level seg",
    JSON.stringify(level.levelSegment(lv, state.objects)),
  );
  console.log(
    "level fill",
    JSON.stringify(level.fillRegion(lv, state.objects)),
  );
  const lvBlock = sync.sourceForObject(
    state.objects.find((o) => o.id === lv.id),
  );
  console.log("--- LEVEL SOURCE ---\n" + lvBlock + "\n--- END ---");

  setImmediate(() => process.exit(0));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

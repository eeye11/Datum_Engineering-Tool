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
  const sync = require(locate("source-synchronization.js"));
  const apply = require(locate("source-model-apply.js"));

  state.objects = [];
  state.selection.selectedObjectIds = [];

  const v = vessel.vesselFromDrag({ x: 10, y: 10 }, { x: -30, y: -20 });
  console.log("reverse drag geom", JSON.stringify(v.geometry));
  ds.addObject(state, v);
  const committed = state.objects.find((o) => o.id === v.id);
  console.log(
    "fluid initial",
    JSON.stringify(committed.engineering.fluidLevel),
  );

  // switch to tank
  console.log(
    "style write",
    schema.writeField(committed, "vesselStyle", "closed"),
  );
  console.log(
    "groups",
    JSON.stringify(
      schema
        .groupsFor(committed)
        .map((g) => ({ id: g.id, fields: g.fields.map((f) => f.key) })),
    ),
  );
  console.log(
    "enabled write",
    schema.writeField(committed, "vesselFluidEnabled", true),
  );
  console.log(
    "percent write",
    schema.writeField(committed, "vesselFluidPercent", 25),
  );
  console.log(
    "enabled?",
    vessel.fluidLevelEnabledOf(committed),
    "percent",
    vessel.fluidLevelPercentOf(committed),
  );
  console.log("seg", JSON.stringify(vessel.fluidLevelSegment(committed)));
  console.log("region", JSON.stringify(vessel.fluidLevelRegion(committed)));

  const block = sync.sourceForObject(committed);
  console.log("--- SOURCE ---\n" + block + "\n--- END ---");

  // invalid percent
  console.log(
    "invalid percent write",
    schema.writeField(committed, "vesselFluidPercent", "abc"),
  );
  console.log("percent after invalid", vessel.fluidLevelPercentOf(committed));
  console.log(
    "clamp write 500",
    schema.writeField(committed, "vesselFluidPercent", 500),
    vessel.fluidLevelPercentOf(committed),
  );

  // resize with level
  const before = vessel.fluidLevelSegment(committed);
  schema.writeField(committed, "vesselHeight", 60);
  const after = vessel.fluidLevelSegment(committed);
  console.log(
    "resize: height",
    committed.geometry.height,
    "before",
    JSON.stringify(before.start),
    "after",
    JSON.stringify(after.start),
  );

  // source round trip with percent
  const edited = block.replace("percent=25", "percent=75");
  const source = `\\begin{tikzpicture}[x=1mm, y=1mm]\n${edited}\n\\end{tikzpicture}`;
  apply.applyParsedSourceToDrawing({
    model: ds,
    state,
    source,
    editable: true,
    removeMissing: false,
  });
  const reread = state.objects.find((o) => o.id === v.id);
  console.log(
    "reread percent",
    vessel.fluidLevelPercentOf(reread),
    "enabled",
    vessel.fluidLevelEnabledOf(reread),
  );

  // switching to reservoir hides level
  schema.writeField(reread, "vesselStyle", "open");
  console.log(
    "reservoir enabled?",
    vessel.fluidLevelEnabledOf(reread),
    "stored",
    JSON.stringify(reread.engineering.fluidLevel),
  );

  setImmediate(() => process.exit(0));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

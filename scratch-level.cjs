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
  require(locate("features-editor.js"));

  const make = (style) => {
    state.objects = [];
    const v = vessel.vesselFromDrag({ x: 0, y: 40 }, { x: 40, y: 0 });
    ds.addObject(state, v);
    const c = state.objects.find((o) => o.id === v.id);
    schema.writeField(c, "vesselStyle", style);
    return c;
  };

  for (const style of ["open", "closed"]) {
    const c = make(style);
    console.log(
      `\n== ${style} ==  corners`,
      JSON.stringify(vessel.vesselRect(c).corners),
    );
    console.log(
      "  segments:",
      vessel
        .vesselSegments(c)
        .map((s) => s.name || "?")
        .join(","),
    );
    console.log(
      "  level enabled?",
      vessel.fluidLevelEnabledOf(c),
      "percent",
      vessel.fluidLevelPercentOf(c),
    );
    for (const p of [0, 50, 100]) {
      vessel.setFluidLevelPercent(c, p);
      const seg = vessel.fluidLevelSegment(c);
      const reg = vessel.fluidLevelRegion(c);
      const ys = reg ? reg.points.map((q) => q.y) : [];
      console.log(
        `   ${p}%: surface y=${seg ? seg.start.y : "-"} | fill y ${ys.length ? Math.min(...ys) + ".." + Math.max(...ys) : "none"} | size ${reg ? reg.points.length : 0}`,
      );
    }
  }

  setImmediate(() => process.exit(0));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

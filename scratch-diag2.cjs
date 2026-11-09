const { bootApp, whenReady } = require("./tests/helpers/boot-app.cjs");
const { locate } = require("./tests/helpers/source-path.cjs");

(async () => {
  const page = bootApp();
  if (page.error) throw page.error;
  await whenReady();

  const vessel = require(locate("model/fluids/reservoir-tank.js")).default;

  const v = {
    id: "v",
    type: "reservoir-tank",
    geometry: { position: { x: 0, y: 0 }, width: 40, height: 40 },
    engineering: {
      vesselStyle: "open",
      fluidLevel: { enabled: true, percent: 50 },
    },
  };
  const rect = vessel.vesselRect(v);
  console.log("rect", JSON.stringify(rect.position), rect.width, rect.height);
  console.log("corners", JSON.stringify(rect.corners));
  console.log(
    "localOf anchor",
    JSON.stringify(vessel.localOf(rect, { x: 0, y: 0 })),
  );
  console.log(
    "worldOf(0,0)",
    JSON.stringify(vessel.worldOf(rect, { x: 0, y: 0 })),
  );
  console.log(
    "worldOf(0,20)",
    JSON.stringify(vessel.worldOf(rect, { x: 0, y: 20 })),
  );
  console.log("segment", JSON.stringify(vessel.fluidLevelSegment(v)));
  console.log("region", JSON.stringify(vessel.fluidLevelRegion(v)));

  setImmediate(() => process.exit(0));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

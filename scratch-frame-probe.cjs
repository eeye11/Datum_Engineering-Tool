const { bootApp, whenReady } = require("./tests/helpers/boot-app.cjs");
const { locate } = require("./tests/helpers/source-path.cjs");

(async () => {
  const page = bootApp();
  if (page.error) throw page.error;
  await whenReady();

  const vessel = require(locate("model/fluids/reservoir-tank.js")).default;

  // A vessel anchored at the origin, 40 wide, 20 tall.
  const v = {
    id: "v",
    type: "reservoir-tank",
    geometry: { position: { x: 0, y: 0 }, width: 40, height: 20 },
    engineering: { vesselStyle: "closed" },
  };
  const rect = vessel.vesselRect(v);

  console.log("vesselRect corners:", JSON.stringify(rect.corners));
  console.log(
    "worldOf(y=0)  ->",
    JSON.stringify(vessel.worldOf(rect, { x: 0, y: 0 })),
  );
  console.log(
    "worldOf(y=20) ->",
    JSON.stringify(vessel.worldOf(rect, { x: 0, y: 20 })),
  );
  console.log(
    "localOf(corner0)",
    JSON.stringify(vessel.localOf(rect, rect.corners[0])),
  );
  console.log(
    "localOf(corner2)",
    JSON.stringify(vessel.localOf(rect, rect.corners[2])),
  );
  console.log(
    "localOf(corner3)",
    JSON.stringify(vessel.localOf(rect, rect.corners[3])),
  );

  v.engineering.fluidLevel = { enabled: true, percent: 25 };
  console.log("25% surface:", JSON.stringify(vessel.fluidLevelSegment(v)));
  console.log(
    "25% region :",
    JSON.stringify(vessel.fluidLevelRegion(v).points),
  );

  setImmediate(() => process.exit(0));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

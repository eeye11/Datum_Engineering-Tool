const path = require("path");
const { JSDOM } = require("jsdom");
const { createHarness } = require("./harness-renderer.cjs");
createHarness(path.join(__dirname, ".."), JSDOM, require);
const { loadModule } = require("./helpers/source-path.cjs");
const sync = loadModule("source-synchronization.js");
const managerModule = loadModule("drawing-source-manager.js");
const statics = loadModule("statics.js");
const geometry = loadModule("geometry.js");

const STYLE = { stroke: "#193335", lineWidth: 0.75 };
const beam = (id, start, end) => ({
  id,
  type: "beam",
  name: id,
  geometry: { start, end },
  style: { ...STYLE },
});
const force = (id, start, magnitude, angle) => ({
  id,
  type: "force",
  name: id,
  geometry: { start, position: start, magnitude, angle },
  style: { ...STYLE },
});

const manager = managerModule.createSourceManager();
sync.setSourceWriter(geometry.geometrySourceWriter);
sync.addSourceWriter(statics.staticsSourceWriter);

const sheet = [beam("b", { x: 0, y: 100 }, { x: 0, y: 103 })];
sync.writeObjectIntoSource(manager, sheet[0], { allObjects: sheet });
console.log(manager.getSource());
console.log("FIT:", JSON.stringify(sync.exportTransformFor(sheet).factor));
console.log(
  "POINT:",
  JSON.stringify(sync.exportTransformFor(sheet).point(0, 100)),
);

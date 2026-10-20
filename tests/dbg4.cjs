const path = require("path");
const { JSDOM } = require("jsdom");
const { createHarness } = require("./harness-renderer.cjs");
createHarness(path.join(__dirname, ".."), JSDOM, require);
const { loadModule } = require("./helpers/source-path.cjs");

const sync = loadModule("source-synchronization.js");
const managerModule = loadModule("drawing-source-manager.js");
const statics = loadModule("statics.js");
const bounds = loadModule("model-bounds.js");
const transform = loadModule("export-transform.js");

const objects = [
  {
    id: "beam",
    type: "beam",
    geometry: { start: { x: -215, y: 0 }, end: { x: 215, y: 0 } },
    style: { lineWidth: "thin" },
  },
  {
    id: "sfd",
    type: "analysis-diagram",
    name: "SFD 1",
    geometry: {
      start: { x: -215, y: -60 },
      end: { x: 215, y: -60 },
      localRange: { from: 0, to: 10 },
      mode: "sketch",
      sketchElements: [],
    },
    style: { lineWidth: "thin" },
  },
  {
    id: "pin",
    type: "pin-support",
    geometry: { position: { x: -215, y: 0 }, orientation: Math.PI / 2 },
    style: { lineWidth: "thin" },
  },
];

const b = bounds.drawingBounds(objects);
console.log("bounds:", b);

const ctx = transform.createExportContext({ bounds: b });
console.log("factor:", ctx.factor.toFixed(4));

const manager = managerModule.createSourceManager();
sync.setSourceWriter(loadModule("geometry.js").geometrySourceWriter);
sync.addSourceWriter(statics.staticsSourceWriter);
objects.forEach((o) =>
  sync.writeObjectIntoSource(manager, o, { allObjects: objects }),
);

const source = manager.getSource();
console.log(
  source
    .split("\n")
    .filter((l) => l.includes("\\draw"))
    .join("\n"),
);
console.log("--- zoom independence is structural: no camera is read ---");

/* Same drawing, generated twice: identical. */
const manager2 = managerModule.createSourceManager();
sync.setSourceWriter(loadModule("geometry.js").geometrySourceWriter);
sync.addSourceWriter(statics.staticsSourceWriter);
objects.forEach((o) =>
  sync.writeObjectIntoSource(manager2, o, { allObjects: objects }),
);
console.log("idempotent:", manager2.getSource() === source);

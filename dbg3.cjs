const path = require("path");
const { JSDOM } = require("jsdom");
const { createHarness } = require("./tests/harness-renderer.cjs");
createHarness(path.join(__dirname), JSDOM, require);
const { loadModule } = require("./tests/helpers/source-path.cjs");
const g = loadModule("geometry.js");
const s = loadModule("statics.js");
console.log(
  "GEO:",
  g.geometrySourceWriter({
    id: "l",
    type: "line",
    geometry: { start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
    style: { lineWidth: "thin" },
  }),
);
console.log(
  "GEO black:",
  g.geometrySourceWriter({
    id: "l2",
    type: "line",
    geometry: { start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
    style: {},
  }),
);
console.log(
  "STAT:",
  s.serializeStaticsObject({
    id: "b",
    type: "beam",
    geometry: { start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
    style: { lineWidth: "thin" },
  }),
);
console.log(
  "FAR:",
  s.serializeStaticsObject({
    id: "f",
    type: "beam",
    geometry: { start: { x: -251.5, y: -400 }, end: { x: 180, y: -400 } },
    style: { lineWidth: "thin" },
  }),
);

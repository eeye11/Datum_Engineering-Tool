const path = require("path");
const { JSDOM } = require("jsdom");
const { createHarness } = require("./harness-renderer.cjs");
createHarness(path.join(__dirname, ".."), JSDOM, require);
const { loadModule } = require("./helpers/source-path.cjs");
const g = loadModule("geometry.js");
const t = loadModule("export-transform.js");
const b = loadModule("model-bounds.js");

const small = [
  {
    id: "s",
    type: "line",
    geometry: { start: { x: 0, y: 0 }, end: { x: 40, y: 20 } },
    style: { lineWidth: "thin" },
  },
];
const fit = t.createExportContext({ bounds: b.drawingBounds(small) });
console.log("small bounds", b.drawingBounds(small), "factor", fit.factor);
console.log(
  "A:",
  JSON.stringify(g.geometrySourceWriter(small[0], { transform: fit })),
);

const scaled = t.createExportContext({
  bounds: { minX: 0, minY: 0, maxX: 430 / 0.3488, maxY: 10 / 0.3488 },
});
console.log(
  "cal factor",
  scaled.factor,
  "w",
  t.boundsWidth({ minX: 0, maxX: 430 / 0.3488 }),
);
console.log(
  "B:",
  JSON.stringify(
    g.geometrySourceWriter(
      {
        id: "l",
        type: "line",
        geometry: { start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
        style: { lineWidth: "thin", lineType: "dashed" },
      },
      { transform: scaled },
    ),
  ),
);

const pin = {
  id: "p",
  type: "pin-support",
  geometry: { position: { x: 100, y: 0 }, orientation: Math.PI / 2 },
  style: { lineWidth: "thin" },
};
const s = loadModule("statics.js");
console.log(
  "C:",
  JSON.stringify(s.serializeStaticsObject(pin, { transform: scaled })),
);

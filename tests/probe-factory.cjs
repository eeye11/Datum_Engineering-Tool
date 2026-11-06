/* Probe: what does resizeBoxFromCorner return inside the drag.js context? */
const { bootApp } = require("./helpers/boot-app.cjs");
const { locate } = require("./helpers/source-path.cjs");
bootApp();

const model = require(locate("drawing-state.js")).default;
const resize = require(locate("box-resize.js"));
const geometry = model.geometryFactories.rectangle(
  { x: 0, y: 0 },
  80,
  50,
).geometry;
console.log("factory geometry:", JSON.stringify(geometry));
console.log(
  "resize result:",
  JSON.stringify(resize.resizeBoxFromCorner(geometry, 0, { x: -20, y: 15 })),
);
process.exit(0);

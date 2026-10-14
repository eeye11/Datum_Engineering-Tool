const { loadModule } = require("../helpers/source-path.cjs");

loadModule("drawing-state.js");
const pipe = loadModule("pipe-duct.js");

const P = pipe.default || pipe;
console.log("exports:", Object.keys(P).slice(0, 40));

const feature = P.createPipeDuct({ x: 0, y: 0 }, { x: 100, y: 0 });
console.log("feature:", JSON.stringify(feature, null, 2));

if (feature) {
  const lines = P.boundaryLines(
    feature.geometry.start,
    feature.geometry.end,
    feature.engineering,
  );
  console.log("boundaryLines:", JSON.stringify(lines, null, 2));
  console.log("separation:", P.boundarySeparation(feature.engineering));
}

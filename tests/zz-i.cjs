const m = require("../src/shared/rendering/latex/source-model.js");
const t =
  "\\definecolor{daetumC123456}{RGB}{18,52,86}\n" +
  "\\draw[draw=daetumC123456, line width=1.2pt]\n  (0,0)\n  -- (80,0)\n  -- (80,40)\n  -- cycle;";
const s = m.shapeFromStatement(t);
console.log("shape:", JSON.stringify(s));
const t2 =
  "\\definecolor{daetumC123456}{RGB}{18,52,86}\n\\draw (0,0) -- (80,0) -- (80,40) -- cycle;";
console.log("shape2:", JSON.stringify(m.shapeFromStatement(t2)));
const t3 = "\\draw[black] (0,0) -- (80,0) -- (80,40) -- cycle;";
console.log("shape3:", JSON.stringify(m.shapeFromStatement(t3)));

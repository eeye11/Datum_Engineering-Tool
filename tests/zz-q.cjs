const m = require("../src/shared/rendering/latex/source-model.js");
const t =
  "\\draw[draw=daetumC123456, line width=1.2pt] (0,0) -- (80,0) -- (80,40) -- cycle;";
console.log("A", JSON.stringify(m.shapeFromStatement(t)));
const t2 = "\\draw (0,0) -- (80,0) -- (80,40) -- cycle;";
console.log("B", JSON.stringify(m.shapeFromStatement(t2)));
const t3 = "\\draw[black] (0,0) -- (80,0) -- (80,40) -- cycle;";
console.log("C", JSON.stringify(m.shapeFromStatement(t3)));
const t4 = "\\draw[draw=red] (0,0) -- (80,0) -- (80,40) -- cycle;";
console.log("D", JSON.stringify(m.shapeFromStatement(t4)));

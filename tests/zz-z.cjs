const m = require("../src/shared/rendering/latex/source-model.js");
const t =
  "\\draw[draw=daetumC123456, line width=1.2pt] (0,0) -- (80,0) -- (80,40) -- cycle;";
console.log("A:", JSON.stringify(m.shapeFromStatement(t)));
console.log(
  "trimmed-name check:",
  JSON.stringify(
    m.shapeFromStatement("\\draw[black] (0,0) -- (80,0) -- (80,40) -- cycle;"),
  ),
);

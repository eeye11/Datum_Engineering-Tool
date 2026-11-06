const m = require("../src/shared/rendering/latex/source-model.js");
const t = [
  "\\definecolor{daetumC123456}{RGB}{18,52,86}",
  "\\draw[draw=daetumC123456, line width=1.2pt] (0,0) -- (80,0) -- (80,40) -- cycle;",
].join("\n");
console.log("full:", JSON.stringify(t));
console.log(
  "pathAt:",
  t.search(/\\(?:draw|fill|filldraw|shade|shadedraw|clip|path)\b/),
);
console.log(
  "ops:",
  JSON.stringify(m.pathOperations(" (0,0) -- (80,0) -- (80,40) -- cycle")),
);
console.log("shape:", JSON.stringify(m.shapeFromStatement(t)));
console.log(
  "bare:",
  JSON.stringify(
    m.shapeFromStatement("\\draw[black] (0,0) -- (80,0) -- (80,40) -- cycle;"),
  ),
);

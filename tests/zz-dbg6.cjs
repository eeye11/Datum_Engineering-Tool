const sm = require("../src/shared/rendering/latex/source-model.js");
[
  "\\draw (0,50) -- (40,0) -- (80,50) -- cycle;",
  "\\draw[draw=daetumC123456] (0,50) -- (40,0) -- (80,50) -- cycle;",
  "\\draw[black] (0,50) -- (40,0) -- (80,50) -- cycle;",
  "\\draw (0,0) -- (10,0) -- (10,10) -- cycle;",
].forEach((t) => {
  const s = sm.shapeFromStatement(t);
  console.log(JSON.stringify(t), "=>", s && s.type, s && s.closed);
});

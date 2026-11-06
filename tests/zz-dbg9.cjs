const s = require("../src/shared/rendering/latex/source-statements.js");
const sm = require("../src/shared/rendering/latex/source-model.js");
const t = "\\draw[black]\n  (0,0)\n  -- (80,0)\n  -- (80,40)\n  -- cycle;";
s.splitStatements(t).forEach((x) =>
  console.log("NAME", JSON.stringify(x.name), "COMPLETE", x.complete),
);
console.log("SHAPE", JSON.stringify(sm.shapeFromStatement(t)));
console.log(
  "SHAPE1",
  JSON.stringify(
    sm.shapeFromStatement(
      "\\draw[black] (0,0)\n  -- (80,0)\n  -- (80,40)\n  -- cycle;",
    ),
  ),
);

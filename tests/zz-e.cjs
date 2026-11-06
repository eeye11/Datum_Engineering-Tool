const m = require("../src/shared/rendering/latex/source-model.js");
const text =
  "\\definecolor{daetumC123456}{RGB}{18,52,86}\n\\draw[draw=daetumC123456, line width=1.2pt]\n  (0,0)\n  -- (80,0)\n  -- (80,40)\n  -- cycle;";
const pathAt = text.search(
  /\\(?:draw|fill|filldraw|shade|shadedraw|clip|path)\b/,
);
const pathText = text.slice(pathAt);
const pathName = /^\\([A-Za-z]+)/.exec(pathText)[1];
const rawBody = pathText.slice(1 + pathName.length).replace(/;\s*$/, "");
const firstToken = rawBody.search(/[()]|\+\+/);
const body = rawBody.slice(firstToken).trim();
console.log("pathName:", pathName);
console.log("rawBody head:", JSON.stringify(rawBody.slice(0, 40)));
console.log("body:", JSON.stringify(body));
console.log(
  "ops:",
  JSON.stringify(m.pathOperations(" " + body).map((o) => o.type)),
);
console.log("shapeFromStatement:", JSON.stringify(m.shapeFromStatement(text)));

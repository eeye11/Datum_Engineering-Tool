const t =
  "\\draw[draw=daetumC123456, line width=1.2pt] (0,0) -- (80,0) -- (80,40) -- cycle;";
const pathAt = t.search(/\\(?:draw|fill|filldraw|shade|shadedraw|clip|path)\b/);
const pathText = t.slice(pathAt);
const pathName = /^\\([A-Za-z]+)/.exec(pathText)[1];
const rawBody = pathText.slice(1 + pathName.length).replace(/;\s*$/, "");
console.log("rawBody:", JSON.stringify(rawBody));
const firstToken = rawBody.search(/[()]|\+\+/);
console.log("firstToken:", firstToken);
const body = rawBody.slice(firstToken).trim();
console.log("body:", JSON.stringify(body));
const m = require("../src/shared/rendering/latex/source-model.js");
console.log(
  "ops:",
  JSON.stringify(m.pathOperations(" " + body).map((o) => o.type)),
);

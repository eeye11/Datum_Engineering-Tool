const m = require("../src/shared/rendering/latex/source-model.js");
const t = "\\draw[black] (0,0) -- (80,0) -- (80,40) -- cycle;";
const text = t.trim();
const pathAt = text.search(
  /\\(?:draw|fill|filldraw|shade|shadedraw|clip|path)\b/,
);
const pathText = text.slice(pathAt);
const pathName = /^\\([A-Za-z]+)/.exec(pathText)[1];
const optionMatch = /^\s*\[([^\]]*)\]/.exec(
  pathText.slice(1 + pathName.length),
);
console.log(
  "pathAt",
  pathAt,
  "pathText",
  JSON.stringify(pathText.slice(0, 20)),
);
console.log("pathName", JSON.stringify(pathName));
console.log("optionMatch", JSON.stringify(optionMatch && optionMatch[1]));
console.log(
  "lineWidthOf:",
  /\bline\s*width\s*=\s*([\d.]+)\s*mm/.exec(optionMatch ? optionMatch[1] : ""),
);
console.log("shape:", JSON.stringify(m.shapeFromStatement(t)));

const fs = require("fs");
const src = fs.readFileSync(
  "../src/shared/rendering/latex/source-model.js",
  "utf8",
);

const start = src.indexOf("function optionsAt");
const end = src.indexOf("function coordinateValue");
const optionsFn = src.slice(start, end);

const pathOpsStart = src.indexOf("function pathOperations");
const pathOpsEnd = src.indexOf("function shapeOfPath");
const pathOps = src.slice(pathOpsStart, pathOpsEnd);

const shapeStart = src.indexOf("function shapeOfPath(");
const shapeEnd = src.indexOf(
  "\n}\n",
  src.indexOf("lineWidth: lineWidthOf", shapeStart),
);
const shapeFn = src.slice(shapeStart, shapeEnd + 3);

const helpersStart = src.indexOf("function definedColour");
const helpersEnd = src.indexOf("/* `\\node at (x,y)");
const helpers = src.slice(helpersStart, helpersEnd);

const bodyStart = src.indexOf("function shapeFromStatement(");
const bodyEnd = src.indexOf(
  "\n}\n",
  src.indexOf("lineWidth: lineWidthOf", bodyStart),
);
const bodyFn = src.slice(bodyStart, bodyEnd + 3);

const code = `
${optionsFn}
${pathOps}
${helpers}
${shapeFn}
${bodyFn}
return shapeFromStatement;
`;

const fn = new Function(code);

const text =
  "\\definecolor{daetumC123456}{RGB}{18,52,86}\n\\draw[draw=daetumC123456, line width=1.2pt] (0,0) -- (80,0) -- cycle;";
const pathAt = text.search(
  /\\(?:draw|fill|filldraw|shade|shadedraw|clip|path)\b/,
);
const pathText = text.slice(pathAt);
const pathName = /^\\([A-Za-z]+)/.exec(pathText)[1];
console.log("pathAt", pathAt, "pathName", pathName, "len", pathText.length);
console.log("charAt:", JSON.stringify(pathText[0]));
console.log("optionsAt direct:", JSON.stringify(optionsFn ? "" : ""));
console.log("result:", JSON.stringify(fn(text)));

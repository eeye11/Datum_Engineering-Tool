const fs = require("fs");
const file = "../src/shared/rendering/latex/source-model.js";
const src = fs.readFileSync(file, "utf8");
const start = src.indexOf("export function shapeFromStatement");
const end = src.indexOf("\n}\n", src.indexOf("return {", start));
const body = src.slice(start, end + 3) + "\n";

const helpersStart = src.indexOf("function optionsAt");
const helpersEnd = src.indexOf("function coordinateValue");
const optionsFn = src.slice(helpersStart, helpersEnd);

const pathOpsStart = src.indexOf("function pathOperations");
const pathOpsEnd = src.indexOf("function shapeOfPath");
const pathOps = src.slice(pathOpsStart, pathOpsEnd);

const fn = new Function(
  `${optionsFn}\n${pathOps}\nlet PATH_COMMANDS = new Set(["draw","fill","filldraw","shade","shadedraw","clip","path"]);\n${body.replace("export ", "")}\nreturn shapeFromStatement;`,
)();

const text =
  "\\definecolor{daetumC123456}{RGB}{18,52,86}\n\\draw[draw=daetumC123456, line width=1.2pt]\n  (0,0)\n  -- (80,0)\n  -- (80,40)\n  -- cycle;";
console.log(
  "pathAt:",
  text.search(/\\(?:draw|fill|filldraw|shade|shadedraw|clip|path)\b/),
);
const pathText = text.slice(
  text.search(/\\(?:draw|fill|filldraw|shade|shadedraw|clip|path)\b/),
);
console.log("pathText:", JSON.stringify(pathText.slice(0, 30)));
console.log("afterName:", JSON.stringify(pathText.slice(5, 20)));
console.log("shape:", JSON.stringify(fn(text)));

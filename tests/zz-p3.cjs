const fs = require("fs");
const src = fs.readFileSync(
  "../src/shared/rendering/latex/source-model.js",
  "utf8",
);

const start = src.indexOf("function definedColour");
const end = src.indexOf("/* `\\node at (x,y)");
const colours = src.slice(start, end);

const lwStart = src.indexOf("function lineWidthOf");
const lwEnd = src.indexOf("\n}\n", src.indexOf("match ? Number", lwStart)) + 3;
const lw = src.slice(lwStart, lwEnd);

const mod = new Function(
  `${colours}\n${lw}\nreturn { colourOf, definitionFor, lineWidthOf };`,
)();

const text =
  "\\definecolor{daetumC123456}{RGB}{18,52,86}\n\\draw[draw=daetumC123456, line width=1.2pt] (0,0) -- (80,0) -- cycle;";
const opts = "draw=daetumC123456, line width=1.2pt";
console.log("definitionFor:", mod.definitionFor(text, "daetumC123456"));
console.log("colourOf:", mod.colourOf(opts, text));
console.log("lineWidthOf:", mod.lineWidthOf(opts));
const strokeName = /(?:draw|color)\s*=\s*\{?\s*([A-Za-z#][A-Za-z0-9#_]*)/.exec(
  opts,
);
console.log("strokeName:", JSON.stringify(strokeName && strokeName[1]));

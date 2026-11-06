const fs = require("fs");
const src = fs.readFileSync(
  "../src/shared/rendering/latex/source-model.js",
  "utf8",
);
const start = src.indexOf("function definedColour");
const end = src.indexOf("/* `\\node at (x,y)");
const mod = new Function(
  `${src.slice(start, end)}; return { colourOf, fillColourOf, definitionFor };`,
)();
const text =
  "\\definecolor{daetumC123456}{RGB}{18,52,86}\n\\definecolor{daetumCABCDEF}{RGB}{171,205,239}\n\\draw[draw=daetumC123456, line width=1.2pt, fill=daetumCABCDEF]\n  (0,0)\n  -- (80,0)\n  -- cycle;";
const opts = "draw=daetumC123456, line width=1.2pt, fill=daetumCABCDEF";
const m = /(?:draw|color)\s*=\s*\{?\s*([A-Za-z#][A-Za-z0-9#_]*)/.exec(opts);
console.log("strokeName match:", m && m[1]);
console.log("definitionFor:", mod.definitionFor(text, m && m[1]));
console.log("colourOf:", mod.colourOf(opts, text));
console.log("fillColourOf:", mod.fillColourOf(opts, text));

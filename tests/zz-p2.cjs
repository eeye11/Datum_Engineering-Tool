const fs = require("fs");
const src = fs.readFileSync(
  "../src/shared/rendering/latex/source-model.js",
  "utf8",
);
const start = src.indexOf("function endOfGroup");
const end = src.indexOf("/* `\\node at (x,y)");
const body = src.slice(start, end);
const mod = new Function(
  `${body}; return { colourOf, fillColourOf, definitionFor, lineWidthOf, optionsAt };`,
)();

const text =
  "\\definecolor{daetumC123456}{RGB}{18,52,86}\n\\draw[draw=daetumC123456, line width=1.2pt]\n  (0,0)\n  -- (80,0)\n  -- cycle;";
const opts = "draw=daetumC123456, line width=1.2pt";
console.log("colourOf:", mod.colourOf(opts, text));
console.log("lineWidthOf:", mod.lineWidthOf(opts));
console.log(
  "definedColour:",
  JSON.stringify(mod.definitionFor(text, "daetumC123456")),
);
const strokeName = /(?:draw|color)\s*=\s*\{?\s*([A-Za-z#][A-Za-z0-9#_]*)/.exec(
  opts,
);
console.log("strokeName:", JSON.stringify(strokeName && strokeName[1]));

const src = require("fs").readFileSync(
  "../src/shared/rendering/latex/source-model.js",
  "utf8",
);
const start = src.indexOf("function definedColour");
const end = src.indexOf("/* `\\node at (x,y)");
const snippet = src.slice(start, end);
const mod = new Function(
  `${snippet}; return { colourOf, fillColourOf, definitionFor, definedColour };`,
)();
const text =
  "\\definecolor{daetumC123456}{RGB}{18,52,86}\n\\draw[draw=daetumC123456, line width=1.2pt] (0,0) -- (80,0) -- cycle;";
console.log("defined:", JSON.stringify(mod.definedColour(text)));
console.log("definitionFor:", mod.definitionFor(text, "daetumC123456"));
console.log(
  "colourOf:",
  mod.colourOf("draw=daetumC123456, line width=1.2pt", text),
);

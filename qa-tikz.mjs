import { renderTikz } from "./server/tikz.js";

const fragment = [
  "\\begin{tikzpicture}[x=1mm, y=1mm]",
  "\\draw (0,0) -- (40,10);",
  "\\end{tikzpicture}",
].join("\n");

await new Promise((r) => setTimeout(r, 4000));

try {
  const svg = await renderTikz(fragment, { debug: true });
  console.log("OK", svg.slice(0, 160));
} catch (error) {
  console.log("FAILED:", error.message);
}
process.exit(0);

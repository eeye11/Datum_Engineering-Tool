/*
 * Reproduce the renderer failure with the exact fixture from the
 * development conversation: a complete standalone LaTeX document.
 *
 * Run: node tests/repro-render-failure.mjs
 */
import fs from "fs";
import { loadTikz, renderTikz, cleanTikZ, tikzStatus } from "../server/tikz.js";

const fixture = fs.readFileSync(
  new URL("./fixtures/complex-standalone-drawing.tex", import.meta.url),
  "utf8",
);

console.log("tikzStatus before load:", tikzStatus());

await loadTikz().catch((error) => {
  console.error("loadTikz failed:", error.message);
  process.exit(1);
});

console.log("tikzStatus after load:", tikzStatus());
console.log("--- cleanTikZ output (what TeX actually receives) ---");
console.log(cleanTikZ(fixture));
console.log("--- end cleanTikZ output ---");

try {
  const svg = await renderTikz(fixture, { debug: true });
  console.log("RENDER OK, svg length:", svg.length);
} catch (error) {
  console.error("RENDER FAILED:", error.message);
  process.exit(1);
}

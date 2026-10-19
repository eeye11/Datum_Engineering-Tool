/* Diagnostics: capture the real TeX console output for the triangle document. */
import tikzjax from "node-tikzjax";
import { readFileSync } from "fs";

await tikzjax.load();

const doc = readFileSync("tmp-triangle-doc.tex", "utf8");
console.log("=== SOURCE (first 300 chars) ===");
console.log(doc.slice(0, 300));

try {
  const dvi = await tikzjax.tex(doc, { showConsole: true });
  console.log("=== DVI bytes ===", dvi.length);
} catch (e) {
  console.log("=== TEX FAILED ===");
  console.log("message:", e.message);
  console.log("stack:", e.stack);
}

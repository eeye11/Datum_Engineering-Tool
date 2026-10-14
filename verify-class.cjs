const src = require("fs").readFileSync(
  "src/editor/tool-classification.js",
  "utf8",
);
const block = src.match(/export const MULTI_STEP_TOOLS = \[([\s\S]*?)\];/)[1];
const list = [...block.matchAll(/"([a-z0-9-]+)"/g)].map((m) => m[1]);
console.log("MULTI_STEP_TOOLS =", list.join(", "));
console.log("contains pipe-duct:", list.includes("pipe-duct"));

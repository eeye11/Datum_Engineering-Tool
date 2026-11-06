const t = "\\draw[black] (0,0) -- (80,0) -- cycle;";
const text = t.trim();
const nameMatch = /^\\([A-Za-z]+\*?)/.exec(text);
const name = nameMatch[1];
console.log("name:", JSON.stringify(name));
const pathAt = text.search(
  /\\(?:draw|fill|filldraw|shade|shadedraw|clip|path)\b/,
);
console.log("pathAt:", pathAt);
const pathText = text.slice(pathAt);
console.log("pathText:", JSON.stringify(pathText));
const pathName = /^\\([A-Za-z]+)/.exec(pathText)[1];
console.log(
  "pathName:",
  JSON.stringify(pathName),
  "idx:",
  1 + pathName.length,
  "char:",
  JSON.stringify(pathText[1 + pathName.length]),
);

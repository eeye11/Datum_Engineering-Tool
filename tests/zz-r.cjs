const t =
  "\\draw[draw=daetumC123456, line width=1.2pt] (0,0) -- (80,0) -- cycle;";
const pathAt = t.search(/\\(?:draw|fill|filldraw|shade|shadedraw|clip|path)\b/);
const pathText = t.slice(pathAt);
const pathName = /^\\([A-Za-z]+)/.exec(pathText)[1];
console.log("pathAt", pathAt, "pathName", JSON.stringify(pathName));
const idx = 1 + pathName.length;
console.log("char at idx", idx, JSON.stringify(pathText[idx]));
console.log("slice", JSON.stringify(pathText.slice(idx, idx + 20)));

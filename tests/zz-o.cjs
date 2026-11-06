const t =
  "\\draw[draw=daetumC123456, line width=1.2pt]\n  (0,0)\n  -- (80,0)\n  --, ok;\n".replace(
    ", ok",
    " cycle",
  );
const pathAt = t.search(/\\(?:draw|fill|filldraw|shade|shadedraw|clip|path)\b/);
const pathText = t.slice(pathAt);
const pathName = /^\\([A-Za-z]+)/.exec(pathText)[1];
const rest = pathText.slice(1 + pathName.length);
console.log("pathName:", pathName);
console.log("rest:", JSON.stringify(rest.slice(0, 30)));
const optionMatch = /^\s*\[([^\]]*)\]/.exec(rest);
console.log("optionMatch:", JSON.stringify(optionMatch && optionMatch[1]));

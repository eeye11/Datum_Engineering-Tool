const { documentFor, cleanTikZ } = await import("./server/tikz.js");
const src = "\\begin{tikzpicture}[x=1mm, y=1mm]\n\\draw (5,5) -- (45,15);\n\\end{tikzpicture}";
console.log("--- anchorOrigin: false ---");
console.log(documentFor(src, { anchorOrigin: false }).split("\\begin{document}")[1].split("\\end{document}")[0].trim());
console.log("--- anchorOrigin: true ---");
console.log(documentFor(src, { anchorOrigin: true }).split("\\begin{document}")[1].split("\\end{document}")[0].trim());
process.exit(0);

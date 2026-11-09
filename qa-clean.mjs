const { cleanTikZ, anchorPictureAtOrigin } = await import("./server/tikz.js");
const src = "\\begin{tikzpicture}[x=1mm, y=1mm]\n\\draw (5,5) -- (45,15);\n\\end{tikzpicture}";
const cleaned = cleanTikZ(src);
console.log("LEN", cleaned.length);
console.log(JSON.stringify(cleaned));
console.log("ANCHORED", JSON.stringify(anchorPictureAtOrigin(cleaned)));
process.exit(0);

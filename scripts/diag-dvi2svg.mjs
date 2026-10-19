/* Diagnostics: DVI -> SVG through the installed node-tikzjax API. */
import tikzjax from "node-tikzjax";

await tikzjax.load();

const doc = String.raw`\documentclass[tikz,border=5pt]{standalone}
\usepackage{tikz}
\usetikzlibrary{arrows.meta}
\begin{document}
\begin{tikzpicture}
  \draw[dashed] (0,0) -- (4,0);
  \fill (0,0) circle (2pt);
\end{tikzpicture}
\end{document}
`;

const dvi = await tikzjax.tex(doc, {});
console.log("DVI bytes:", dvi.length);

const svg = await tikzjax.dvi2svg(dvi);
const text = String(svg);
console.log("SVG type:", typeof svg);
console.log("SVG length:", text.length);
console.log("SVG head:", JSON.stringify(text.slice(0, 200)));
console.log("SVG has <svg:", text.includes("<svg"));
console.log("SVG has path/line:", /path|line|polygon|circle/i.test(text));

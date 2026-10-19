/* Diagnostics: capture the RAW output of node-tikzjax for a standalone document. */
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

const svg = tikzjax.tex(doc, { showConsole: false });
const text = String(svg);
console.log("RAW TYPE:", typeof svg);
console.log("RAW LENGTH:", text.length);
console.log("RAW JSON:", JSON.stringify(text));

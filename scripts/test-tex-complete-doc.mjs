/*
 * Temporary test: verify node-tikzjax can compile a COMPLETE standalone
 * LaTeX document (documentclass + preamble kept intact, no stripping).
 */
import tikzjax from "node-tikzjax";

await tikzjax.load();

const doc = String.raw`\documentclass[tikz,border=5pt]{standalone}
\usepackage{tikz}
\usetikzlibrary{arrows.meta}
\begin{document}
\begin{tikzpicture}
  \draw[dashed] (0,0) -- (5,0);
  \fill (0,0) circle (2pt);
\end{tikzpicture}
\end{document}
`;

try {
  const svg = tikzjax.tex(doc, { showConsole: true });
  console.log("COMPLETE document: OK, svg length =", svg.length);
} catch (error) {
  console.error("COMPLETE document failed:", error.message);
  process.exit(1);
}

/*
 * Temporary test script: verify node-tikzjax can compile a complete
 * standalone LaTeX document with TikZ, libraries, and named coordinates.
 */
import tikzjax from "node-tikzjax";

const DOC = String.raw`
\documentclass[tikz,border=5pt]{standalone}
\usepackage{tikz}
\usetikzlibrary{arrows.meta}
\begin{document}
\begin{tikzpicture}
  \coordinate (A) at (0,0);
  \draw[dashed] (A) -- (5,0);
  \draw[very thick] (1,1) -- (3,1) -- (3,3) -- cycle;
  \draw[very thick] (1,-1) -- (3,-1) -- (3,-3) -- cycle;
  \fill (A) circle (2pt);
  \node[above] at (A) {$x_1$};
  \draw[<->] (0,4) -- (0,6);
  \draw (4,0) arc (0:90:2);
\end{tikzpicture}
\end{document}
`;

const FRAG = String.raw`
\usepackage{tikz}
\usetikzlibrary{arrows.meta}
\begin{document}
\begin{tikzpicture}
  \draw[dashed] (0,0) -- (5,0);
  \fill (0,0) circle (2pt);
\end{tikzpicture}
\end{document}
`;

await tikzjax.load();

for (const [name, doc] of [["full document", DOC], ["fragment", FRAG]]) {
    try {
        const svg = tikzjax.tex(doc, { showConsole: true });
        console.log(`${name}: OK, svg length = ${String(svg).length}`);
    } catch (e) {
        console.error(`${name}: FAILED — ${e.message}`);
    }
}

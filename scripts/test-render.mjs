/*
 * Regression test: render a complete standalone TikZ document through
 * the DAETUM renderer, exercising every construct from the reported failure.
 */
import { loadTikz, tikzStatus, renderTikz } from "../server/tikz.js";

await loadTikz();
console.log("engine status:", tikzStatus());

const doc = String.raw`\documentclass[tikz,border=5pt]{standalone}
\begin{document}
\begin{tikzpicture}
  \draw[dashed] (0,0) -- (4,0);
  \fill (0,0) circle (2pt);
  \draw[<->] (5,0) -- (5,2.5);
  \draw (0,0) -- (1,1) arc[start angle=0, end angle=90, radius=1];
  \node[below] at (2,-0.3) {$F_A$};
\end{tikzpicture}
\end{document}`;

try {
    const svg = await renderTikz(doc, { debug: true });
    console.log("RENDER OK, svg length:", svg.length);
    const checks = ["dashed", "circle", "polygon", "path"];
    for (const c of checks) console.log(`  contains '${c}':`, svg.includes(c));
} catch (error) {
    console.log("RENDER FAILED:", error.message);
    console.log(String(error.stack ?? "").split("\n").slice(0, 12).join("\n"));
}

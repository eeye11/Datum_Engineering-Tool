/* Probe: which of the fixture's constructs node-tikzjax can compile. */
import tikzjax from "node-tikzjax";

await tikzjax.load();

const cases = {
  "plain tikz": String.raw`\documentclass[tikz,border=5pt]{standalone}
\begin{document}
\begin{tikzpicture}
  \draw[dashed] (0,0) -- (4,0);
  \fill (0,0) circle (2pt);
\end{tikzpicture}
\end{document}
`,
  "usetikzlibrary calc": String.raw`\documentclass[tikz,border=5pt]{standalone}
\usepackage{tikz}
\usetikzlibrary{calc}
\begin{document}
\begin{tikzpicture}
  \coordinate (A) at (0,0);
  \draw ($(A)+(1,1)$) -- (2,2);
\end{tikzpicture}
\end{document}
`,
  "coordinate + mm units": String.raw`\documentclass[tikz,border=5pt]{standalone}
\usepackage{tikz}
\begin{document}
\begin{tikzpicture}[x=1mm, y=1mm]
  \coordinate (A) at (0,0);
  \draw[thick] (A) -- (60,0);
  \node[above] at (A) {$A$};
\end{tikzpicture}
\end{document}
`,
  "stealth arrows": String.raw`\documentclass[tikz,border=5pt]{standalone}
\usepackage{tikz}
\usetikzlibrary{arrows.meta}
\begin{document}
\begin{tikzpicture}
  \draw[{Stealth[width=4mm]}-{Stealth[width=4mm]}] (0,0) -- (4,0);
\end{tikzpicture}
\end{document}
`,
  "tfrac + mathrm": String.raw`\documentclass[tikz,border=5pt]{standalone}
\begin{document}
\begin{tikzpicture}
  \node {$F_A = \tfrac{1}{2}wL$};
  \node at (2,0) {$L = 60\,\mathrm{mm}$};
\end{tikzpicture}
\end{document}
`,
  "arc syntax": String.raw`\documentclass[tikz,border=5pt]{standalone}
\begin{document}
\begin{tikzpicture}
  \draw (30,35) arc[start angle=180, end angle=300, radius=6];
\end{tikzpicture}
\end{document}
`,
  "plain article class": String.raw`\documentclass{article}
\usepackage{tikz}
\begin{document}
\begin{tikzpicture}
  \draw (0,0) -- (1,1);
\end{tikzpicture}
\end{document}
`,
  "bare preamble fragment": String.raw`\usepackage{tikz}
\usetikzlibrary{arrows.meta}
\begin{document}
\begin{tikzpicture}
  \draw (0,0) -- (1,1);
\end{tikzpicture}
\end{document}
`,
};

for (const [name, doc] of Object.entries(cases)) {
  try {
    const svg = tikzjax.tex(doc, { showConsole: true });
    console.log(`OK   ${name} (svg length ${String(svg).length})`);
  } catch (e) {
    console.log(`FAIL ${name}: ${e.message}`);
  }
}

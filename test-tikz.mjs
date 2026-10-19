import { load, tex, dvi2svg } from "node-tikzjax";
import fs from "fs";

const source = String.raw`
\usepackage{tikz}

\begin{document}

\begin{tikzpicture}
    \draw (0,0) -- (2,1);
    \draw (0,0) -- (2,-1);
\end{tikzpicture}

\end{document}
`;

try {
    console.log("Loading TikZJax...");

    await load();

    console.log("TikZJax loaded.");
    console.log("Starting LaTeX/TikZ rendering...");

    const dvi = await tex(source, {
        showConsole: true
    });

    console.log("LaTeX compiled successfully.");

    const svg = await dvi2svg(dvi);

    fs.writeFileSync("tikz-test.svg", svg);

    console.log("TikZ rendered successfully!");
    console.log("Created: tikz-test.svg");

} catch (error) {
    console.error("TikZ rendering failed:");
    console.error(error);
}
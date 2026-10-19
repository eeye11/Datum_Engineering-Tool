/*
 * Probe: does the running DAETUM server actually render a statics drawing?
 *
 * Sends the same kind of TikZ the source generator produces for a beam with a
 * pin support, a point force and a dimension, and reports exactly what comes
 * back - success, SVG, or the compiler's complaint.
 */

const endpoint = process.env.DAETUM_URL || "http://localhost:3000";

const staticsSample = String.raw`
\begin{tikzpicture}
  \draw[line width=1.2pt] (0,0) -- (8,0);
  \fill[black] (0,0) circle (2.5pt);
  \draw[black] (-0.35,-0.35) -- (0.35,0.35);
  \draw[black] (-0.35,0.35) -- (0.35,-0.35);
  \draw[-latex, line width=1.2pt] (3,0) -- (3,2);
  \node[above] at (3,2) {$F = 40\,\mathrm{N}$};
  \draw[latex-latex] (0,-0.7) -- (8,-0.7);
  \node[below] at (4,-0.7) {$8\,\mathrm{m}$};
\end{tikzpicture}
`;

async function probe(label, tikz) {
  let response;
  try {
    response = await fetch(`${endpoint}/api/render-tikz`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tikz }),
    });
  } catch (error) {
    console.log(`[${label}] network failure: ${error.message}`);
    return;
  }

  const text = await response.text();
  let payload = null;
  try {
    payload = JSON.parse(text);
  } catch {
    /* not json */
  }

  if (payload) {
    const svg = payload.svg ? String(payload.svg) : "";
    console.log(
      `[${label}] http=${response.status} success=${payload.success} svgLen=${svg.length}`,
    );
    if (payload.error)
      console.log(`[${label}] error: ${String(payload.error).slice(0, 400)}`);
    const paths = (svg.match(/<path/g) || []).length;
    const lines = (svg.match(/<line|<polyline|<polygon/g) || []).length;
    const nodes = (svg.match(/<text|<g /g) || []).length;
    console.log(
      `[${label}] paths=${paths} lineish=${lines} textgroups=${nodes}`,
    );
  } else {
    console.log(
      `[${label}] non-json response (${response.status}): ${text.slice(0, 300)}`,
    );
  }
}

console.log(`Probing ${endpoint}`);
await probe("statics-sample", staticsSample);
await probe("empty-picture", "\\begin{tikzpicture}\n\\end{tikzpicture}");
await probe(
  "syntax-error",
  "\\begin{tikzpicture}\n\\draw (0,0) -- ;\n\\end{tikzpicture}",
);

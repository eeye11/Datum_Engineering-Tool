export default async function run(page) {
  return page.evaluate(async () => {
    const withMarkers = ["\\begin{tikzpicture}[x=1mm, y=1mm]", "% DAETUM OBJECT: Line 1", "% DAETUM ID: line-1", "\\draw (5,5) -- (45,15);", "\\end{tikzpicture}"].join("\n");
    const r = await fetch("/api/render-tikz", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tikz: withMarkers }) });
    const j = await r.json();
    return { ok: j.success, error: j.error, svg: String(j.svg || "").slice(0, 140) };
  });
}

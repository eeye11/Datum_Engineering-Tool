export default async function run(page) {
  return page.evaluate(async () => {
    const src = ["\\begin{tikzpicture}[x=1mm, y=1mm]", "\\draw (5,5) -- (45,15);", "\\end{tikzpicture}"].join("\n");
    const r = await fetch("/api/render-tikz", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tikz: src, anchorOrigin: true }) });
    const j = await r.json();
    const svg = String(j.svg || "");
    return { ok: j.success, err: j.error, attrs: svg.slice(0, 260) };
  });
}

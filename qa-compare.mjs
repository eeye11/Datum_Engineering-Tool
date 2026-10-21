export default async function run(page) {
  return page.evaluate(async () => {
    const src = ["\\begin{tikzpicture}[x=1mm, y=1mm]", "\\draw (5,5) -- (45,15);", "\\end{tikzpicture}"].join("\n");
    const call = async (anchorOrigin) => {
      const r = await fetch("/api/render-tikz", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(anchorOrigin ? { tikz: src, anchorOrigin: true } : { tikz: src }) });
      const j = await r.json();
      return { ok: j.success, svg: String(j.svg || "").slice(0, 180) };
    };
    return { plain: await call(false), anchored: await call(true) };
  });
}

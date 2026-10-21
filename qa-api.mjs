export default async function run(page) {
  return page.evaluate(async () => {
    const fragment = ["\\begin{tikzpicture}[x=1mm, y=1mm]", "\\draw (0,0) -- (40,10);", "\\end{tikzpicture}"].join("\n");
    const json = await fetch("/api/render-tikz", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tikz: fragment, debug: true }) });
    let payload = null;
    try { payload = await json.json(); } catch { payload = null; }
    return { status: json.status, success: payload?.success, error: payload?.error, logTail: String(payload?.log || payload?.console || "").slice(-2500), svgHead: String(payload?.svg || "").slice(0, 120) };
  });
}

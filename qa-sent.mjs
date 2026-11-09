export default async function run(page) {
  const log = [];
  await page.exposeFunction("__note", (m) => log.push(m));
  await page.addInitScript(() => {
    const orig = window.fetch;
    window.fetch = async (url, opts) => {
      const res = await orig(url, opts);
      if (String(url).includes("/api/render-tikz")) {
        const clone = res.clone();
        let payload = null;
        try { payload = await clone.json(); } catch { payload = {}; }
        window.__note({ sent: opts?.body, svg: String(payload.svg || "").slice(0, 220), ok: payload.success, err: payload.error });
      }
      return res;
    };
  });
  await page.goto(page.url());
  await page.waitForTimeout(800);
  await page.evaluate(() => document.querySelector('.tab[data-tab="drawing"]')?.click());
  await page.waitForTimeout(800);
  const canvas = await page.locator(".drawing-canvas").boundingBox();
  await page.evaluate(() => [...document.querySelectorAll("[data-category]")].find(n => n.getAttribute("data-category") === "GEOMETRY")?.click());
  await page.evaluate(() => [...document.querySelectorAll("#drawingToolList button")].find(b => /^Line$/.test(b.textContent.trim()))?.click());
  await page.waitForTimeout(200);
  await page.mouse.click(canvas.x + 200, canvas.y + 200);
  await page.mouse.click(canvas.x + 420, canvas.y + 300);
  await page.waitForTimeout(2000);
  await page.evaluate(() => document.querySelector('.tab[data-tab="writing"]')?.click());
  await page.waitForTimeout(1200);
  await page.evaluate(() => {
    const e = document.getElementById("solutionEditor");
    e.value = "\\datumdrawing{" + "SHEET" + "}\n";
  });
  return log;
}

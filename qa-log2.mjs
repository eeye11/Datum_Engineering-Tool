export default async function run(page) {
  const log = [];
  page.on("request", (req) => {
    if (req.url().includes("/api/render-tikz")) log.push({ sent: String(req.postData() || "").slice(0, 300) });
  });
  page.on("response", async (res) => {
    if (!res.url().includes("/api/render-tikz")) return;
    try {
      const j = JSON.parse(await res.text());
      log.push({ svgHead: String(j.svg || "").slice(0, 150), ok: j.success });
    } catch { log.push({ svgHead: "<non-json>" }); }
  });
  await page.evaluate(() => document.querySelector('.tab[data-tab="drawing"]')?.click());
  await page.waitForTimeout(900);
  const canvas = await page.locator(".drawing-canvas").boundingBox();
  await page.evaluate(() => [...document.querySelectorAll("[data-category]")].find(n => n.getAttribute("data-category") === "GEOMETRY")?.click());
  await page.evaluate(() => [...document.querySelectorAll("#drawingToolList button")].find(b => /^Line$/.test(b.textContent.trim()))?.click());
  await page.waitForTimeout(200);
  await page.mouse.click(canvas.x + 200, canvas.y + 200);
  await page.mouse.click(canvas.x + 420, canvas.y + 300);
  await page.waitForTimeout(800);
  await page.mouse.click(canvas.x + 600, canvas.y + 400);
  await page.waitForTimeout(1800);
  return log;
}

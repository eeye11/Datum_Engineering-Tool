export default async function run(page) {
  const captured = [];
  page.on("response", async (res) => {
    if (!res.url().includes("/api/render-tikz")) return;
    try {
      const j = JSON.parse(await res.text());
      captured.push({ sent: res.request().postData()?.slice(0, 400), svg: String(j.svg || "").slice(0, 140), ok: j.success });
    } catch { captured.push({ sent: "?", ok: false }); }
  });
  await page.evaluate(() => document.querySelector('.tab[data-tab="writing"]')?.click());
  await page.waitForTimeout(700);
  await page.evaluate(() => {
    const e = document.getElementById("solutionEditor");
    e.value = "Text.\n"; e.dispatchEvent(new Event("input", { bubbles: true }));
    e.setSelectionRange(e.value.length, e.value.length);
    document.getElementById("solutionEnterDrawing")?.click();
  });
  await page.waitForTimeout(400);
  await page.evaluate(() => [...document.querySelectorAll(".engg-dialog button")].find(b => b.textContent.trim() === "Draw a new figure")?.click());
  await page.waitForTimeout(1200);
  await page.evaluate(() => document.querySelector('.tab[data-tab="drawing"]')?.click());
  await page.waitForTimeout(700);
  const canvas = await page.locator(".drawing-canvas").boundingBox();
  await page.evaluate(() => [...document.querySelectorAll("[data-category]")].find(n => n.getAttribute("data-category") === "GEOMETRY")?.click());
  await page.waitForTimeout(200);
  await page.evaluate(() => [...document.querySelectorAll("#drawingToolList button")].find(b => /^Line$/.test(b.textContent.trim()))?.click());
  await page.waitForTimeout(200);
  await page.mouse.click(canvas.x + 200, canvas.y + 200);
  await page.mouse.click(canvas.x + 420, canvas.y + 300);
  await page.waitForTimeout(1500);
  await page.evaluate(() => document.querySelector('.tab[data-tab="writing"]')?.click());
  await page.waitForTimeout(3000);
  const text = await page.evaluate(() => document.getElementById("solutionPreview")?.innerText?.slice(-260));
  return { captured, text };
}

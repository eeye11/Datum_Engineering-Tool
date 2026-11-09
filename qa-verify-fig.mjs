export default async function run(page) {
  await page.waitForTimeout(1500); await page.evaluate(() => document.querySelector('.tab[data-tab="drawing"]')?.click());
  await page.waitForTimeout(900);
  const canvas = await page.locator(".drawing-canvas").boundingBox();
  await page.evaluate(() => [...document.querySelectorAll("[data-category]")].find(n => n.getAttribute("data-category") === "GEOMETRY")?.click());
  await page.evaluate(() => [...document.querySelectorAll("#drawingToolList button")].find(b => /^Line$/.test(b.textContent.trim()))?.click());
  await page.waitForTimeout(200);
  await page.mouse.click(canvas.x + 200, canvas.y + 200);
  await page.mouse.click(canvas.x + 430, canvas.y + 320);
  await page.waitForTimeout(1500);
  await page.evaluate(() => document.querySelector('.tab[data-tab="writing"]')?.click());
  await page.waitForTimeout(3000);
  return page.evaluate(() => {
    const fig = document.querySelector(".linked-drawing-figure, .drawing-reference-figure");
    const svg = fig?.querySelector("svg");
    const r = svg?.getBoundingClientRect();
    return {
      figHtml: fig?.innerHTML?.slice(0, 260),
      viewBox: svg?.getAttribute("viewBox"),
      rendered: r ? { w: Math.round(r.width), h: Math.round(r.height) } : null,
      paths: svg?.querySelectorAll("path, line, polyline").length,
      text: fig?.innerText?.slice(0, 120),
    };
  });
}


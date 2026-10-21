export default async function run(page) {
  await page.waitForTimeout(1200);
  await page.evaluate(() => document.querySelector('.tab[data-tab="drawing"]')?.click());
  await page.waitForTimeout(1200);

  const canvas = await page.locator(".drawing-canvas").boundingBox();

  await page.evaluate(() =>
    [...document.querySelectorAll("[data-category]")]
      .find((n) => n.getAttribute("data-category") === "GEOMETRY")
      ?.click(),
  );
  await page.waitForTimeout(200);
  await page.evaluate(() =>
    [...document.querySelectorAll("#drawingToolList button")]
      .find((b) => /^Line$/.test(b.textContent.trim()))
      ?.click(),
  );
  await page.waitForTimeout(200);
  await page.mouse.click(canvas.x + 220, canvas.y + 220);
  await page.waitForTimeout(150);
  await page.mouse.click(canvas.x + 460, canvas.y + 340);
  await page.waitForTimeout(2000);

  await page.evaluate(() => document.querySelector('.tab[data-tab="writing"]')?.click());
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    const e = document.getElementById("solutionEditor");
    e.value = "Text.\n";
    e.dispatchEvent(new Event("input", { bubbles: true }));
    e.setSelectionRange(e.value.length, e.value.length);
    document.getElementById("solutionEnterDrawing")?.click();
  });
  await page.waitForTimeout(500);
  await page.evaluate(() =>
    [...document.querySelectorAll(".engg-dialog button")]
      .find((b) => b.textContent.trim() === "Insert an existing drawing")
      ?.click(),
  );
  await page.waitForTimeout(400);

  const names = await page.evaluate(() =>
    [...document.querySelectorAll(".engg-dialog button")].map((b) => b.textContent.trim()),
  );

  await page.evaluate(() =>
    [...document.querySelectorAll(".engg-dialog button")]
      .find((b) => /^Sheet/.test(b.textContent.trim()))
      ?.click(),
  );
  await page.waitForTimeout(3000);

  const measured = await page.evaluate(() => {
    const fig = document.querySelector(".linked-drawing-figure");
    const svg = fig?.querySelector("svg");
    const rect = svg?.getBoundingClientRect();

    return {
      text: fig?.innerText?.slice(0, 200) || null,
      viewBox: svg?.getAttribute("viewBox") || null,
      size: rect ? { w: Math.round(rect.width), h: Math.round(rect.height) } : null,
      shapes: svg ? svg.querySelectorAll("path, line, polyline").length : 0,
    };
  });

  return { names, measured };
}

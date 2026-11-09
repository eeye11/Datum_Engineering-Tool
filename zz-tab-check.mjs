export default async function run(page, ui) {
  await page.waitForTimeout(2500);
  const before = await page.evaluate(() => ({
    tabs: [...document.querySelectorAll(".tab[data-tab]")].map(
      (t) => t.dataset.tab,
    ),
    activeSection: document.querySelector(".review-content.active")?.id || null,
  }));

  const tab = page.locator('.tab[data-tab="drawing"]');
  await tab.click();
  await page.waitForTimeout(1500);

  const after = await page.evaluate(() => ({
    activeSection: document.querySelector(".review-content.active")?.id || null,
    drawingActive:
      document.getElementById("drawing")?.classList.contains("active") || false,
    canvasExists: Boolean(document.querySelector(".drawing-canvas")),
    canvasChildren:
      document.querySelector(".drawing-canvas")?.children.length ?? -1,
    canvasBox: (() => {
      const c = document.querySelector(".drawing-canvas");
      if (!c) return null;
      const r = c.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height) };
    })(),
    toolButtons: document.querySelectorAll(".drawing-tool").length,
    sheetBar: Boolean(
      document.querySelector(".drawing-sheet-tabs, .drawing-sheet"),
    ),
  }));

  return { before, after };
}

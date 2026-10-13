/*
 * Is the drawing canvas actually sized once the tab is shown?
 */
export default async function run(page, ui) {
  await page.waitForTimeout(800);
  await page.locator('.tab[data-tab="drawing"]').click();
  await page.waitForTimeout(1200);

  return await page.evaluate(() => {
    const drawing = document.querySelector("#drawing");
    const candidates = [...document.querySelectorAll("svg, canvas")].map(
      (el) => {
        const r = el.getBoundingClientRect();
        return {
          tag: el.tagName,
          id: el.id || null,
          cls: (el.getAttribute("class") || "").slice(0, 60),
          w: Math.round(r.width),
          h: Math.round(r.height),
          parent:
            el.parentElement?.id || el.parentElement?.className?.slice(0, 40),
        };
      },
    );

    return {
      drawingRect: drawing
        ? {
            w: Math.round(drawing.getBoundingClientRect().width),
            h: Math.round(drawing.getBoundingClientRect().height),
          }
        : null,
      bigCanvases: candidates.filter((c) => c.w > 100 || c.h > 100),
      allCanvasCount: candidates.length,
    };
  });
}

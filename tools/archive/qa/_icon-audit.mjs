export default async function run(page, ui) {
  // Open the Engineering Drawing tab (the toolbar lives there).
  const tab = page.getByText("Engineering Drawing", { exact: true }).first();
  if (await tab.count()) {
    await tab.click();
    await page.waitForTimeout(800);
  }

  await page.waitForSelector(".drawing-style-strip", { timeout: 15000 });
  await page.waitForTimeout(400);

  // Where do the boxed value controls and the toggles actually sit?
  const layout = await page.evaluate(() => {
    const pick = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return {
        w: Math.round(r.width),
        h: Math.round(r.height),
        border:
          cs.borderTopWidth + " " + cs.borderTopStyle + " " + cs.borderTopColor,
        radius: cs.borderTopLeftRadius,
        bg: cs.backgroundColor,
      };
    };
    return {
      thicknessbox: pick(".drawing-strip-icon"),
      colourbox: pick(".drawing-strip-colour"),
      grid: pick("#drawingGridToggle"),
      snap: pick("#drawingSnapToggle"),
      dims: pick("#drawingDimensionsToggle"),
      mags: pick("#drawingMagnitudesToggle"),
      vs: pick(".drawing-vector-scale"),
      toggles: [...document.querySelectorAll(".drawing-status-toggle")].map(
        (b) => b.id,
      ),
    };
  });

  return { layout };
}

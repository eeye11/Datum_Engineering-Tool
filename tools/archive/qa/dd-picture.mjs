// Open the line-type dropdown and screenshot the area it opens into, so the
// popup layout can actually be seen rather than inferred.
export default async function run(page) {
  const tab = page.getByText("Engineering Drawing", { exact: true }).first();

  if (await tab.count()) {
    await tab.click();
    await page.waitForTimeout(900);
  }

  await page.waitForSelector(".drawing-style-strip", { timeout: 15000 });

  // Focus the select and open it with the keyboard (Alt+Down opens natively).
  await page.focus("#drawingLineType");
  await page.keyboard.press("Alt+ArrowDown");
  await page.waitForTimeout(700);

  await page.screenshot({ path: "_dd-open.png", fullPage: false });

  const geom = await page.evaluate(() => {
    const el = document.getElementById("drawingLineType");
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return {
      rect: {
        x: Math.round(r.x),
        y: Math.round(r.y),
        w: Math.round(r.width),
        h: Math.round(r.height),
      },
      fontSize: cs.fontSize,
      lineHeight: cs.lineHeight,
      minWidth: cs.minWidth,
      matchesOpen: el.matches(":open"),
    };
  });

  return geom;
}

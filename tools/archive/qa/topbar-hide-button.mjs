/*
 * Verify the Hide control:
 *   - it lives on the style strip (the Thickness row)
 *   - it sits to the RIGHT of the other controls
 *   - it stays VISIBLE at every width, including mobile
 *   - it still collapses and restores the drawing's two top bars
 *   - the header, filename and tabs are never hidden
 */
export default async function run(page) {
  const errs = [];
  page.on("pageerror", (e) =>
    errs.push("PAGEERROR: " + e.message.slice(0, 220)),
  );
  page.on("console", (m) => {
    if (m.type() === "error") errs.push("CONSOLE: " + m.text().slice(0, 180));
  });

  await page.evaluate(async () => {
    await import("/src/main.js");
  });
  await page.waitForFunction(
    () => !!(window.enggDrawing && window.enggDrawing.state),
    { timeout: 15000 },
  );

  const tab = page
    .locator("button", { hasText: "Engineering Drawing" })
    .first();
  if (await tab.count()) await tab.click();
  await page.waitForTimeout(900);

  const probe = () =>
    page.evaluate(() => {
      const btn = document.getElementById("headerHideButton");
      const strip = document.querySelector(".drawing-style-strip");
      const r = btn.getBoundingClientRect();
      const s = strip.getBoundingClientRect();

      const visible =
        !!btn.offsetParent &&
        r.width > 0 &&
        r.height > 0 &&
        r.left >= -1 &&
        r.right <= window.innerWidth + 1 &&
        r.top >= -1;

      // Is it on the strip, and to the right of the strip's other controls?
      const others = [...strip.children].filter((c) => c !== btn);
      const maxOtherRight = Math.max(
        ...others.map((c) => c.getBoundingClientRect().right),
      );

      return {
        onStrip: strip.contains(btn),
        visible,
        withinViewportX: r.left >= -1 && r.right <= window.innerWidth + 1,
        x: Math.round(r.x),
        right: Math.round(r.right),
        w: Math.round(r.width),
        h: Math.round(r.height),
        stripRight: Math.round(s.right),
        maxOtherRight: Math.round(maxOtherRight),
        labelVisible:
          btn.querySelector(".header-hide-text").getBoundingClientRect().width >
          0,
        viewportW: window.innerWidth,
      };
    });

  const out = { errs, byWidth: {} };

  for (const width of [1400, 1024, 900, 760, 620, 520, 460, 390, 360]) {
    await page.setViewportSize({ width, height: 820 });
    await page.waitForTimeout(400);
    out.byWidth[width] = await probe();
  }

  // Now confirm the action still works and only the two bars go.
  await page.setViewportSize({ width: 390, height: 820 });
  await page.waitForTimeout(400);

  await page.locator("#headerHideButton").click();
  await page.waitForTimeout(500);

  out.afterHide = await page.evaluate(() => {
    const vis = (sel) => {
      const el = document.querySelector(sel);
      return !!(el && el.offsetParent !== null);
    };
    return {
      headerVisible: vis(".header"),
      tabsVisible: vis(".tabs"),
      toolbarVisible: vis(".drawing-app-toolbar"),
      sectionBarVisible: vis(".drawing-toolbar"),
      stripVisible: vis(".drawing-style-strip"),
      showControlVisible: vis("#drawingTopBarShow"),
      hideButtonVisible: vis("#headerHideButton"),
    };
  });

  return out;
}

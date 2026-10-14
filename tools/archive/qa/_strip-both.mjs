// Two screenshots of the style strip - one per theme - plus the icon paths, so
// the redesigned icons can be checked as a set.
export default async function run(page) {
  const tab = page.getByText("Engineering Drawing", { exact: true }).first();

  if (await tab.count()) {
    await tab.click();
    await page.waitForTimeout(900);
  }

  await page.waitForSelector(".drawing-style-strip", { timeout: 15000 });
  await page.waitForTimeout(300);

  const strip = page.locator(".drawing-style-strip").first();
  const box = await strip.boundingBox();

  const clip = {
    x: Math.max(0, box.x - 6),
    y: Math.max(0, box.y - 6),
    width: box.width + 12,
    height: box.height + 12,
  };

  await page.screenshot({ path: "_strip2-light.png", clip });

  // Switch to dark through the app's own theme storage, then reload.
  await page.evaluate(() => {
    localStorage.setItem("datum.theme", "dark");
    document.documentElement.setAttribute("data-theme", "dark");
  });

  await page.waitForTimeout(400);
  await page.screenshot({ path: "_strip2-dark.png", clip });

  return {
    iconPaths: await page.evaluate(() => {
      const ids = [
        "drawingGridToggle",
        "drawingSnapToggle",
        "drawingDimensionsToggle",
        "drawingMagnitudesToggle",
      ];

      return ids.map((id) => {
        const svg = document.querySelector("#" + id + " svg");
        return {
          id,
          paths: svg ? svg.innerHTML.length : 0,
          html: svg ? svg.outerHTML : null,
        };
      });
    }),
  };
}

/*
 * Live: build two lines with plain clicks (known-good), then Smart Dimension.
 */
export default async function run(page, ui) {
  const out = {};

  const tab = (await ui.snapshot()).match(
    /@(e\d+) button "Engineering Drawing"/,
  )?.[1];
  if (tab) {
    await ui.click(tab);
    await page.waitForTimeout(900);
  }

  const shelf = (name) =>
    page.evaluate((n) => {
      document
        .querySelector(`.drawing-category[data-category="${n}"]`)
        ?.click();
    }, name);
  const pickTool = async (id) => {
    await page.evaluate((tid) => {
      document
        .querySelector(`#drawingToolList [data-tool-id="${tid}"]`)
        ?.click();
    }, id);
    await page.waitForTimeout(250);
  };

  const rect = await page.evaluate(() => {
    const r = document.querySelector(".drawing-canvas").getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  const clickAt = async (fx, fy) => {
    await page.mouse.click(rect.x + rect.w * fx, rect.y + rect.h * fy);
    await page.waitForTimeout(400);
  };

  await shelf("GEOMETRY");
  await pickTool("line");
  await clickAt(0.3, 0.6);
  await clickAt(0.7, 0.6);
  await pickTool("line");
  await clickAt(0.3, 0.75);
  await clickAt(0.7, 0.75);

  out.geom = await page.evaluate(() => {
    const svg = document.querySelector(".drawing-canvas svg");
    return Array.from(svg?.querySelectorAll("line") || [])
      .filter((l) => (l.getAttribute("stroke-dasharray") || "").length === 0)
      .map(
        (l) =>
          `${l.getAttribute("x1")},${l.getAttribute("y1")} -> ${l.getAttribute("x2")},${l.getAttribute("y2")}`,
      );
  });

  return out;
}

/*
 * Live: create two lines and report where they are, so a dimension can aim.
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
    await page.waitForTimeout(300);
  };

  await shelf("GEOMETRY");
  await pickTool("line");
  await clickAt(0.2, 0.6);
  await clickAt(0.6, 0.6);

  out.canvasRect = rect;
  out.svgText = await page.evaluate(
    () =>
      document.querySelector(".drawing-canvas svg")?.outerHTML.slice(0, 3000) ||
      "NO SVG",
  );
  out.featureIds = await page.evaluate(() =>
    Array.from(
      document.querySelectorAll(".drawing-canvas [data-feature-id]"),
    ).map((e) => e.getAttribute("data-feature-id")),
  );

  // Read the model's own object list through the state module.
  out.objectSummary = await page.evaluate(() => {
    const el = document.querySelector(".drawing-canvas");
    return el ? el.getAttribute("data-shape-count") : null;
  });

  return out;
}

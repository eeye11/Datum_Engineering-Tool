export default async function run(page, ui) {
  await page.waitForTimeout(1000);
  await page.evaluate(() => {
    [...document.querySelectorAll("button")]
      .find((b) => b.textContent.trim() === "Engineering Drawing")
      ?.click();
  });
  await page.waitForTimeout(900);

  const out = {};
  out.beforeCat = await page.evaluate(() => ({
    active: document.querySelector(".drawing-category.active")?.dataset
      .category,
    heading: document.querySelector("#drawingToolHeading")?.textContent?.trim(),
  }));

  // Click FLUIDS category the way the QA probes do.
  const clicked = await page.evaluate(() => {
    const el = document.querySelector(
      '.drawing-category[data-category="FLUIDS"]',
    );
    if (!el) return "no el";
    el.click();
    return "clicked";
  });
  await page.waitForTimeout(500);

  out.afterCat = await page.evaluate(() => ({
    active: document.querySelector(".drawing-category.active")?.dataset
      .category,
    heading: document.querySelector("#drawingToolHeading")?.textContent?.trim(),
    tools: [...document.querySelectorAll(".drawing-tool")].map(
      (b) => b.dataset.toolId,
    ),
    hasPipe: Boolean(
      document.querySelector('.drawing-tool[data-tool-id="pipe-duct"]'),
    ),
    hasElbow: Boolean(
      document.querySelector('.drawing-tool[data-tool-id="elbow"]'),
    ),
  }));
  out.clicked = clicked;
  return out;
}

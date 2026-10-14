/*
 * Fluids QA: what does pressing Pipe / Duct actually arm?
 */
export default async function run(page, ui) {
  await page.waitForFunction(
    () => document.querySelectorAll(".drawing-category").length > 0,
    { timeout: 20000 },
  );

  await page.evaluate(() => {
    document.querySelector('.tab[data-tab="drawing"]')?.click();
  });
  await page.waitForTimeout(300);

  await page.evaluate(() => {
    [...document.querySelectorAll(".drawing-category")]
      .find((el) => el.dataset.category === "FLUIDS")
      ?.click();
  });
  await page.waitForTimeout(200);

  const press = async (id) => {
    await page.evaluate((toolId) => {
      document
        .querySelector(`.drawing-tool[data-tool-id="${toolId}"]`)
        ?.click();
    }, id);
    await page.waitForTimeout(150);

    return page.evaluate((toolId) => {
      const active = document.querySelector(".drawing-tool.active");
      return {
        buttonExists: Boolean(
          document.querySelector(`.drawing-tool[data-tool-id="${toolId}"]`),
        ),
        highlightedId: active?.dataset.toolId || null,
        highlightedLabel:
          active?.querySelector(".drawing-tool-label")?.textContent?.trim() ||
          null,
        message:
          document.querySelector("#drawingToolMessage")?.textContent?.trim() ||
          "",
      };
    }, id);
  };

  const pipe = await press("pipe-duct");
  const tank = await press("reservoir-tank");
  const pump = await press("pump");

  return { pipe, tank, pump };
}

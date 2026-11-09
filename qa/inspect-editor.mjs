export default async function run(page) {
  await page.waitForSelector(".drawing-category", { timeout: 120000 });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: "MATH / ANALYSIS", exact: true }).click();

  await page.waitForSelector('#drawingToolList [data-tool-id="math-plot"]', {
    timeout: 30000,
  });

  await page.locator('#drawingToolList [data-tool-id="math-plot"]').first().click();
  await page.waitForTimeout(600);

  const menu = await page.evaluate(() => {
    const node = document.querySelector(".drawing-coordinate-submenu");

    return {
      present: Boolean(node),
      text: node?.innerText || null,
      options: node
        ? [...node.querySelectorAll("[data-submenu-id]")].map(
            (option) => option.dataset.submenuId,
          )
        : null,
    };
  });

  if (menu.options && menu.options.includes("sketch")) {
    await page.locator('.drawing-coordinate-submenu [data-submenu-id="sketch"]').first().click();
    await page.waitForTimeout(1500);
  }

  const editor = await page.evaluate(() => {
    const dialog = document.querySelector(".drawing-graph-sketch");

    return {
      opened: Boolean(dialog),
      className: dialog?.className || null,
      hook: dialog ? typeof dialog.__datumSketch : null,
      keys: dialog
        ? Object.getOwnPropertyNames(dialog).filter((key) => key.startsWith("__"))
        : null,
      stage: Boolean(dialog?.querySelector("[data-sketch-stage]")),
      svg: Boolean(dialog?.querySelector("[data-sketch-svg]")),
      therefore: document.querySelectorAll(".drawing-graph-sketch").length,
    };
  });

  return { menu, editor };
}

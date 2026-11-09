export default async function run(page) {
  const errors = [];

  page.on("pageerror", (error) => errors.push(String(error.stack || error).slice(0, 1200)));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push("console: " + message.text().slice(0, 600));
  });

  await page.waitForSelector(".drawing-category", { timeout: 120000 });
  await page.getByRole("button", { name: "MATH / ANALYSIS", exact: true }).click();
  await page.waitForSelector('#drawingToolList [data-tool-id="math-plot"]', { timeout: 30000 });
  await page.locator('#drawingToolList [data-tool-id="math-plot"]').first().click();
  await page.waitForTimeout(500);

  const before = await page.evaluate(() => document.querySelector(".drawing-coordinate-submenu")?.innerText);

  await page.locator('.drawing-coordinate-submenu [data-submenu-id="sketch"]').first().click();
  await page.waitForTimeout(2000);

  const after = await page.evaluate(() => {
    const dialog = document.querySelector(".drawing-graph-sketch");

    return {
      hook: dialog ? typeof dialog.__datumSketch : null,
      htmlStart: dialog?.outerHTML.slice(0, 200),
      parents: (() => {
        const chain = [];
        let node = dialog;

        while (node && chain.length < 4) {
          chain.push(node.tagName + "." + node.className);
          node = node.parentElement;
        }

        return chain;
      })(),
    };
  });

  return { before, after, errors };
}

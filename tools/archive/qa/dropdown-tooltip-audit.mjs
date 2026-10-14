// The tooltip/aria-label each control ends up with, after syncStyleLabels runs.
export default async function run(page) {
  const tab = page.getByText("Engineering Drawing", { exact: true }).first();

  if (await tab.count()) {
    await tab.click();
    await page.waitForTimeout(800);
  }

  await page.waitForSelector(".drawing-style-strip", { timeout: 15000 });

  return await page.evaluate(() => {
    const read = (id) => {
      const el = document.getElementById(id);
      return {
        title: el.getAttribute("title"),
        aria: el.getAttribute("aria-label"),
      };
    };

    return {
      thickness: read("drawingThickness"),
      lineType: read("drawingLineType"),
      colour: read("drawingColor"),
    };
  });
}

// Read the two style-strip dropdowns exactly as the browser sees them.
export default async function run(page) {
  const tab = page.getByText("Engineering Drawing", { exact: true }).first();

  if (await tab.count()) {
    await tab.click();
    await page.waitForTimeout(800);
  }

  await page.waitForSelector(".drawing-style-strip", { timeout: 15000 });

  return await page.evaluate(() => {
    const dump = (id) => {
      const sel = document.getElementById(id);
      return {
        value: sel.value,
        options: [...sel.options].map((o) => ({
          value: o.value,
          text: o.textContent,
        })),
      };
    };

    return {
      thickness: dump("drawingThickness"),
      lineType: dump("drawingLineType"),
    };
  });
}

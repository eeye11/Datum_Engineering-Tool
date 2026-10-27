export default async function run(page) {
  await page.evaluate(() => {
    document.querySelector('.tab[data-tab="drawing"]')?.click();
  });

  await page.waitForTimeout(800);

  const toolbar = await page.evaluate(() => {
    const list = document.querySelector("#drawingToolList");

    return {
      exists: Boolean(list),
      headings: [
        ...document.querySelectorAll(
          "#drawingToolHeading, .drawing-tool-heading, [data-tool-category]",
        ),
      ].map((n) => n.textContent.trim().slice(0, 40)),
      buttons: [...(list?.querySelectorAll("button") || [])].map((b) => ({
        text: b.textContent.trim(),
        title: b.getAttribute("title"),
        tool: b.getAttribute("data-tool") || b.dataset.tool,
      })),
    };
  });

  return toolbar;
}

export default async function run(page) {
  await page.waitForSelector(".drawing-category", { timeout: 120000 });
  await page.waitForTimeout(800);

  const before = await page.evaluate(() => ({
    categories: [...document.querySelectorAll(".drawing-category")].map((node) => ({
      text: node.textContent.trim(),
      cls: node.className,
    })),
    tools: document.querySelectorAll("#drawingToolList button").length,
    heading: document.querySelector("#drawingToolHeading")?.textContent,
  }));

  await page.getByRole("button", { name: "MATH / ANALYSIS", exact: true }).click();
  await page.waitForTimeout(1200);

  const after = await page.evaluate(() => ({
    tools: [...document.querySelectorAll("#drawingToolList button")].map((node) => ({
      id: node.dataset.toolId || null,
      text: node.innerText.trim().slice(0, 30),
      visible: node.getBoundingClientRect().width > 0,
    })),
    heading: document.querySelector("#drawingToolHeading")?.textContent,
  }));

  return { before, after };
}

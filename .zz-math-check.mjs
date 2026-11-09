export default async (page) => {
  await page.click('.drawing-category[data-category="MATH / ANALYSIS"]');
  await page.waitForTimeout(400);

  const groups = await page.evaluate(() =>
    [...document.querySelectorAll(".drawing-tool-group")].map((group) => ({
      label: group.querySelector(".drawing-tool-group-label")?.textContent.trim(),
      tools: [...group.querySelectorAll(".drawing-tool")].map((button) => ({
        id: button.dataset.toolId,
        label: button.querySelector(".drawing-tool-label")?.textContent.trim(),
        hasIcon: Boolean(button.querySelector(".drawing-tool-icon svg")),
      })),
    })),
  );

  return { groups };
};

export default async function run(page) {
  const out = { steps: [] };
  const log = (s, v) => out.steps.push({ step: s, value: v });
  const tab = page.getByRole("button", { name: "Engineering Drawing" });
  if (await tab.count()) {
    await tab.first().click();
    await page.waitForTimeout(400);
  }
  await page.locator('.drawing-category[data-category="STATICS"]').click();
  await page.waitForTimeout(250);
  for (const [parent, label] of [
    ["moment", "Moments"],
    ["support", "Supports"],
    ["load", "Loads"],
    ["connection", "Connections"],
  ]) {
    await page.locator(`.drawing-tool[data-tool-id="${parent}"]`).click();
    await page.waitForTimeout(300);
    out.steps.push({
      step: "submenu " + parent,
      value: await page.evaluate(() =>
        [...document.querySelectorAll(".drawing-coordinate-submenu-item")].map(
          (i) => i.dataset.submenuId,
        ),
      ),
    });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(150);
    await page.locator(`.drawing-tool[data-tool-id="${parent}"]`).click();
    await page.waitForTimeout(200);
  }
  return out;
}

/*
 * Narrow in on the "click a second menu label" behaviour.
 */
export default async function run(page) {
  await page.getByRole("button", { name: "Engineering Drawing" }).click();
  await page.waitForTimeout(300);

  const steps = [];

  await page.locator('.datum-menu-label[data-menu-id="file"]').click();
  await page.waitForTimeout(150);
  steps.push({
    step: "open File",
    file: await page.locator(".datum-menu-panel-file").count(),
    openId: await page.evaluate(
      () =>
        document.querySelector(".datum-menu-open .datum-menu-label")?.dataset
          .menuId ?? null,
    ),
  });

  /*
   * Click Edit. Log what the bar looks like immediately after, and what the
   * label's aria-expanded says, to tell "closed File" from "opened Edit".
   */
  await page.locator('.datum-menu-label[data-menu-id="edit"]').click();
  await page.waitForTimeout(250);

  steps.push({
    step: "click Edit",
    file: await page.locator(".datum-menu-panel-file").count(),
    edit: await page.locator(".datum-menu-panel-edit").count(),
    openId: await page.evaluate(
      () =>
        document.querySelector(".datum-menu-open .datum-menu-label")?.dataset
          .menuId ?? null,
    ),
    expanded: await page.evaluate(() =>
      [...document.querySelectorAll(".datum-menu-label")].map((l) => [
        l.dataset.menuId,
        l.getAttribute("aria-expanded"),
      ]),
    ),
  });

  /* Now click Edit a second time - the "toggle closed" path. */
  await page.locator('.datum-menu-label[data-menu-id="edit"]').click();
  await page.waitForTimeout(250);
  steps.push({
    step: "click Edit again",
    edit: await page.locator(".datum-menu-panel-edit").count(),
  });

  return steps;
}

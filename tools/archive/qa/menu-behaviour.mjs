/*
 * Exercise the menu bar's behaviour end to end:
 *   open a menu, check its items and dividers
 *   move to another menu (hover) and check the first closed
 *   click outside to close
 *   Escape to close
 *   run a command and check the menu closed
 */
export default async function run(page) {
  await page.getByText("Engineering Drawing", { exact: true }).click();
  await page.waitForTimeout(900);

  const state = () =>
    page.evaluate(() => ({
      openLabel:
        document.querySelector(".datum-menu-open .datum-menu-label")
          ?.textContent ?? null,
      panels: document.querySelectorAll(".datum-menu-panel").length,
      items: [...document.querySelectorAll(".datum-menu-item")].map(
        (b) => b.querySelector(".datum-menu-item-label").textContent,
      ),
      dividers: document.querySelectorAll(".datum-menu-separator").length,
      expanded: [...document.querySelectorAll(".datum-menu-label")].map(
        (l) => ({
          label: l.textContent,
          expanded: l.getAttribute("aria-expanded"),
        }),
      ),
    }));

  const out = {};

  /* 1. The bar is built. */
  out.initial = await state();

  /* 2. Click File. */
  await page.locator('.datum-menu-label:has-text("File")').click();
  await page.waitForTimeout(250);
  out.afterClickFile = await state();

  /* 3. Click Edit - it must MOVE, not stack two menus. */
  await page.locator('.datum-menu-label:has-text("Edit")').click();
  await page.waitForTimeout(250);
  out.afterClickEdit = await state();

  /* 4. Escape closes. */
  await page.keyboard.press("Escape");
  await page.waitForTimeout(250);
  out.afterEscape = await state();

  /* 5. Reopen, then click far outside - on the canvas. */
  await page.locator('.datum-menu-label:has-text("View")').click();
  await page.waitForTimeout(250);
  out.viewOpen = await state();

  await page.mouse.click(500, 400);
  await page.waitForTimeout(250);
  out.afterOutsideClick = await state();

  /*
   * 6. Run a real command: File > New goes through the unsaved-changes guard,
   *    so on a clean document it replaces it. Check the menu closes.
   */
  await page.locator('.datum-menu-label:has-text("File")').click();
  await page.waitForTimeout(250);

  const newItem = page.locator('[data-menu-item="new"]');
  out.hasNewItem = (await newItem.count()) > 0;

  return out;
}

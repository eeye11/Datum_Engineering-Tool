/*
 * The View menu's three visibility switches:
 *   the label says what the command WILL DO (Hide while shown, Show while hidden)
 *   there is NO tick beside any of them
 */
export default async function run(page) {
  await page.getByText("Engineering Drawing", { exact: true }).click();
  await page.waitForTimeout(1000);

  const readView = async () => {
    await page.locator('.datum-menu-label:text-is("View")').click();
    await page.waitForTimeout(250);

    const data = await page.evaluate(() => {
      const grab = (id) => {
        const item = document.querySelector(`[data-menu-item="${id}"]`);
        if (!item) return null;

        const labelEl = item.querySelector(".datum-menu-item-label");
        const before = labelEl
          ? getComputedStyle(labelEl, "::before").content
          : null;

        return {
          label: labelEl?.textContent,
          hasCheckedClass: item.classList.contains("datum-menu-item-checked"),
          ariaChecked: item.getAttribute("aria-checked"),
          tickContent: before,
        };
      };

      return {
        grid: grab("grid"),
        dimensions: grab("dimensions"),
        magnitudes: grab("magnitudes"),
        dividerCount: document.querySelectorAll(".datum-menu-separator").length,
      };
    });

    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);

    return data;
  };

  const shown = await readView();

  /* Now turn Grid off from the toolbar and read the menu again. */
  await page.click("#drawingGridToggle");
  await page.waitForTimeout(300);

  const gridOff = await readView();

  /* Turn it back on. */
  await page.click("#drawingGridToggle");
  await page.waitForTimeout(300);

  return {
    whileGridShown: shown,
    afterGridHidden: gridOff,
  };
}

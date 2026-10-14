/*
 * Grid and Snap must survive being turned OFF and ON again, and the ICON must
 * still be there afterwards. This is the regression check for the bug where a
 * toggle's `textContent` write replaced its SVG with the words "Grid OFF".
 */
export default async function run(page) {
  await page.getByRole("button", { name: "Engineering Drawing" }).click();
  await page.waitForTimeout(400);

  const snapshot = async (id) => {
    return await page.evaluate((buttonId) => {
      const b = document.getElementById(buttonId);
      return {
        svgChildren: b.querySelectorAll("svg").length,
        pathCount: b.querySelectorAll("svg path, svg rect, svg circle").length,
        text: b.textContent.trim(),
        active: b.classList.contains("active"),
        pressed: b.getAttribute("aria-pressed"),
        title: b.getAttribute("title"),
      };
    }, id);
  };

  const steps = {};

  for (const id of [
    "drawingGridToggle",
    "drawingSnapToggle",
    "drawingDimensionsToggle",
    "drawingMagnitudesToggle",
  ]) {
    steps[id] = { before: await snapshot(id) };

    await page.locator("#" + id).click();
    await page.waitForTimeout(200);
    steps[id].afterOff = await snapshot(id);

    await page.locator("#" + id).click();
    await page.waitForTimeout(200);
    steps[id].afterOnAgain = await snapshot(id);
  }

  /*
   * And the same cycle from the VIEW MENU, which is the other writer.
   */
  await page.locator('.datum-menu-label[data-menu-id="view"]').click();
  await page.waitForTimeout(200);
  await page.locator('.datum-menu-item[data-menu-item="grid"]').click();
  await page.waitForTimeout(250);
  steps.gridViaMenu = await snapshot("drawingGridToggle");

  await page.locator('.datum-menu-label[data-menu-id="view"]').click();
  await page.waitForTimeout(200);
  await page.locator('.datum-menu-item[data-menu-item="grid"]').click();
  await page.waitForTimeout(250);
  steps.gridViaMenuBack = await snapshot("drawingGridToggle");

  return steps;
}

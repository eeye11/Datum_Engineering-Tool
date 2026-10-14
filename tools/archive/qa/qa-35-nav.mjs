import { makeHelpers } from "./qa-helpers.mjs";

export default async function run(page) {
  const out = {};
  const h = await makeHelpers(page);
  await h.category("STATICS");

  await h.tool("load");
  await h.sub("Varying Distributed Load");
  await h.click(0.15, 0.5);
  await h.click(0.85, 0.5);
  await h.move(0.45, 0.3);
  await h.click(0.45, 0.3);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(600);

  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  const row = page
    .locator("#drawingProperties .drawing-component-row[data-object-id]")
    .first();
  out.rowCount = await row.count();
  await row.click();
  await page.waitForTimeout(400);
  out.afterFirstClick = {
    selected: await h.evalInPage(
      page,
      `var s=window.enggDrawing.state;
      document.documentElement.setAttribute("data-qa", JSON.stringify(s.selection.selectedObjectIds));`,
    ),
    reverse: await page.evaluate(
      () => document.querySelectorAll("[data-load-reverse-direction]").length,
    ),
    backDisplay: await page.evaluate(
      () => document.querySelector("#drawingFeaturesBack").style.display,
    ),
  };
  await row.click();
  await page.waitForTimeout(700);
  out.afterSecondClick = {
    reverse: await page.evaluate(
      () => document.querySelectorAll("[data-load-reverse-direction]").length,
    ),
    panel: await h.panelText(),
  };
  return out;
}

import { makeHelpers, evalInPage } from "./qa-helpers.mjs";

export default async function run(page) {
  const out = {};
  const h = await makeHelpers(page);
  await h.category("STATICS");

  await h.tool("load");
  await h.sub("Distributed Load");
  await h.click(0.15, 0.5);
  await h.click(0.85, 0.5);
  await h.move(0.45, 0.3);
  await h.click(0.45, 0.3);
  await page.waitForTimeout(600);

  const rows = () =>
    page.locator("#drawingProperties .drawing-component-row[data-object-id]");
  out.rows0 = await rows().count();

  // Click once, re-resolve, click again.
  await rows().first().click();
  await page.waitForTimeout(500);
  out.count1 = await rows().count();
  out.reverse1 = await page.evaluate(
    () => document.querySelectorAll("[data-load-reverse-direction]").length,
  );

  await rows().first().click();
  await page.waitForTimeout(800);
  out.reverse2 = await page.evaluate(
    () => document.querySelectorAll("[data-load-reverse-direction]").length,
  );
  out.count2 = await rows().count();
  out.panel = await h.panelText();

  return out;
}

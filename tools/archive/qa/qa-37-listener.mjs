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

  // How many click listeners does the row actually carry? If the
  // view toggles twice in one click, that shows up here.
  out.listeners = () =>
    evalInPage(
      page,
      `
    var r = document.querySelector("#drawingProperties .drawing-component-row[data-object-id]");
    document.documentElement.setAttribute("data-qa", JSON.stringify({
      exists: !!r,
      dataId: r ? r.dataset.objectId : null,
      selected: r ? r.className : null
    }));`,
    );

  await h.evalInPage(
    page,
    `document.documentElement.setAttribute("data-qa", JSON.stringify(1));`,
  );
  out.before = await out.listeners();

  const row = page
    .locator("#drawingProperties .drawing-component-row[data-object-id]")
    .first();
  await row.click();
  await page.waitForTimeout(500);
  out.afterOne = await out.listeners();

  await row.click();
  await page.waitForTimeout(800);
  out.afterTwo = await out.listeners();
  out.reverse = await page.evaluate(
    () => document.querySelectorAll("[data-load-reverse-direction]").length,
  );
  return out;
}

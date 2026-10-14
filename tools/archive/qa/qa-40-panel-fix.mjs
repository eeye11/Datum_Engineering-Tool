import { makeHelpers } from "./qa-helpers.mjs";

export default async function run(page) {
  const out = { steps: [] };
  const log = (s, v) => out.steps.push({ step: s, value: v });
  const safe = async (n, f) => {
    try {
      log(n, await f());
    } catch (e) {
      log(n, { error: String(e).slice(0, 250) });
    }
  };

  const h = await makeHelpers(page);
  await h.category("STATICS");

  const openEdit = async () => {
    const row = page
      .locator("#drawingProperties .drawing-component-row[data-object-id]")
      .first();
    await row.click();
    await page.waitForTimeout(400);
    await row.click();
    await page.waitForTimeout(700);
  };

  // --- Distributed Load
  await h.tool("load");
  await h.sub("Distributed Load");
  await h.click(0.15, 0.5);
  await h.click(0.85, 0.5);
  await h.move(0.45, 0.3);
  await h.click(0.45, 0.3);
  await page.waitForTimeout(500);

  await openEdit();
  await safe("DL reverse button", () =>
    page.evaluate(
      () => document.querySelectorAll("[data-load-reverse-direction]").length,
    ),
  );
  await safe("DL panel", h.panelText);
  await safe("DL fields", () =>
    page.evaluate(() =>
      [...document.querySelectorAll("#drawingProperties [data-property]")].map(
        (n) => n.dataset.property,
      ),
    ),
  );

  // Edit a property and confirm the model changes.
  await h.setField("interval", 33);
  await safe(
    "DL interval after edit",
    async () => (await h.selected()).geometry.interval,
  );

  // Deselect and reselect.
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  await page
    .locator(".drawing-canvas")
    .first()
    .click({ position: { x: 20, y: 20 } });
  await page.waitForTimeout(400);
  await openEdit();
  await safe("DL panel after reselect", h.panelText);

  return out;
}

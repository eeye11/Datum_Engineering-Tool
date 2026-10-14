/*
 * Verify the RESTORED (previous) load Features tab renders in the real page:
 *   LOADED BODY  -> Relative to + Start/End stations (only when attached)
 *   FORCE        -> Direction, Reverse, Interval
 *   DISTRIBUTION -> Point N Magnitude + Position rows
 *
 * Also asserts no console errors while the panel is built.
 */
export default async function run(page, ui) {
  const out = { steps: [], consoleErrors: [] };

  page.on("console", (msg) => {
    if (msg.type() === "error")
      out.consoleErrors.push(msg.text().slice(0, 300));
  });
  page.on("pageerror", (err) =>
    out.consoleErrors.push(String(err).slice(0, 300)),
  );

  const log = (s, v) => out.steps.push({ step: s, value: v });
  const safe = async (n, f) => {
    try {
      log(n, await f());
    } catch (e) {
      log(n, { error: String(e).slice(0, 300) });
    }
  };

  const h = await import("./qa-helpers.mjs").then((m) => m.makeHelpers(page));

  const openEdit = async () => {
    const row = page
      .locator("#drawingProperties .drawing-component-row[data-object-id]")
      .first();
    await row.click();
    await page.waitForTimeout(250);
    await row.click();
    await page.waitForTimeout(450);
  };

  const panel = () =>
    page.evaluate(() => {
      const host = document.querySelector("#drawingProperties");
      return {
        sections: [
          ...host.querySelectorAll(".drawing-property-grid-label"),
        ].map((n) => n.textContent.trim()),
        fields: [...host.querySelectorAll("[data-property]")].map((n) => ({
          key: n.dataset.property,
          value: n.value,
        })),
        headings: [...host.querySelectorAll("*")].some((n) =>
          /Relative to/.test(n.textContent || ""),
        ),
      };
    });

  /* ---- Free-space Distributed Load ---- */
  await h.category("STATICS");
  await h.tool("load");
  await h.sub("Distributed Load");
  await h.press(0.15, 0.3);
  await h.press(0.8, 0.3);
  {
    const f = page.locator("#drawingLoadMagnitude");
    await f.fill("12");
    await f.press("Enter");
    await page.waitForTimeout(300);
    await h.move(0.5, 0.7);
    await h.press(0.5, 0.7);
  }
  await safe("distributed-panel", async () => {
    await openEdit();
    return panel();
  });

  /* ---- Varying Distributed Load ---- */
  await page.keyboard.press("Escape");
  await h.tool("load");
  await h.sub("Varying Distributed Load");
  await h.press(0.15, 0.5);
  await h.press(0.8, 0.5);
  await h.move(0.3, 0.4);
  await h.press(0.3, 0.4);
  await h.move(0.7, 0.55);
  await h.press(0.7, 0.55);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(400);
  await safe("varying-panel", async () => {
    await openEdit();
    return panel();
  });

  return out;
}

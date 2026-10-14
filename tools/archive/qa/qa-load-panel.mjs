import { makeHelpers } from "./qa-helpers.mjs";

/*
 * VERIFY the restored load Features tab in the real page:
 *   Distributed Load    -> Start X/Y, End X/Y, Length, Intensity (N/m)
 *   Varying Distributed  -> Start X/Y, End X/Y, Length, Start/End Magnitude (N/mm)
 * and that editing a magnitude and a length round-trips.
 */
export default async function run(page) {
  const out = { steps: [] };
  const log = (s, v) => out.steps.push({ step: s, value: v });
  const safe = async (n, f) => {
    try {
      log(n, await f());
    } catch (e) {
      log(n, { error: String(e).slice(0, 300) });
    }
  };

  const h = await makeHelpers(page);

  const openEdit = async () => {
    const row = page
      .locator("#drawingProperties .drawing-component-row[data-object-id]")
      .first();
    await row.click();
    await page.waitForTimeout(300);
    await row.click();
    await page.waitForTimeout(500);
  };

  const panel = () =>
    page.evaluate(() => {
      const host = document.querySelector("#drawingProperties");
      const fields = [...host.querySelectorAll("[data-property]")].map((n) => ({
        key: n.dataset.property,
        value: n.value,
      }));
      return {
        labels: [...host.querySelectorAll(".drawing-property-grid-label")].map(
          (n) => n.textContent.trim(),
        ),
        units: [...host.querySelectorAll(".drawing-property-unit")].map((n) =>
          n.textContent.trim(),
        ),
        fields,
      };
    });

  const loads = () =>
    h.evalInPage(
      page,
      `
      var st = window.enggDrawing.state;
      document.documentElement.setAttribute("data-qa", JSON.stringify(
        st.objects.filter(function (o) {
          return o.type === "load" || o.type === "varying-load";
        }).map(function (o) {
          function len(g) { return Math.hypot(g.end.x - g.start.x, g.end.y - g.start.y); }
          return { type: o.type, intensity: o.geometry.intensity,
            startIntensity: o.geometry.startIntensity,
            endIntensity: o.geometry.endIntensity,
            length: len(o.geometry), start: o.geometry.start, end: o.geometry.end };
        })));`,
    );

  /* ---- Distributed Load ---- */
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
  await safe("distributed-created", loads);
  await safe("distributed-panel", async () => {
    await openEdit();
    return panel();
  });

  await safe("edit-intensity-25", async () => {
    const f = page
      .locator('#drawingProperties input[data-property="intensity"]')
      .first();
    if ((await f.count()) === 0) return "no intensity field";
    await f.fill("25");
    await f.press("Enter");
    await page.waitForTimeout(400);
    return true;
  });
  await safe("after-intensity-25", loads);

  await safe("edit-length-100", async () => {
    const f = page
      .locator('#drawingProperties input[data-property="length"]')
      .first();
    if ((await f.count()) === 0) return "no length field";
    await f.fill("100");
    await f.press("Enter");
    await page.waitForTimeout(400);
    return true;
  });
  await safe("after-length-100", loads);
  await safe("panel-length-after", panel);

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
  await safe("varying-created", loads);
  await safe("varying-panel", async () => {
    await openEdit();
    return panel();
  });

  return out;
}

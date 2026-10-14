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

  // --- Varying Distributed Load with several points.
  await h.tool("load");
  await h.sub("Varying Distributed Load");
  await h.click(0.15, 0.5);
  await h.click(0.85, 0.5);
  await h.move(0.4, 0.3);
  await h.click(0.4, 0.3);
  await h.move(0.6, 0.38);
  await h.click(0.6, 0.38);
  await h.move(0.85, 0.44);
  await h.click(0.85, 0.44);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(600);

  await openEdit();
  await safe("VDL reverse button", () =>
    page.evaluate(
      () => document.querySelectorAll("[data-load-reverse-direction]").length,
    ),
  );
  await safe("VDL panel", h.panelText);
  await safe("VDL point fields", () =>
    page.evaluate(() =>
      [...document.querySelectorAll("#drawingProperties [data-property]")]
        .map((n) => n.dataset.property)
        .filter((k) => k.startsWith("loadPoint")),
    ),
  );

  const before = await h.selected();
  await safe("VDL points before edit", () => before.geometry.points);

  // Edit a distribution point position and magnitude.
  await h.setField("loadPoint.1.t", 55);
  await h.setField("loadPoint.1.magnitude", 17);
  const after = await h.selected();
  await safe("VDL points after edit", () => after.geometry.points);
  await safe("VDL point count unchanged", () => ({
    before: before.geometry.points.length,
    after: after.geometry.points.length,
  }));

  // Every defined point must still be a real arrow.
  await safe("every defined point is an arrow", () =>
    h.evalInPage(
      page,
      `
      var st = window.enggDrawing.state;
      var id = (st.selection && st.selection.selectedObjectIds || [])[0];
      var f = null; st.objects.forEach(function (o) { if (o.id === id) f = o; });
      var p = window.enggLoadProfile;
      var pts = p.profilePoints(f.geometry);
      var s = p.arrowSamples(f.geometry);
      document.documentElement.setAttribute("data-qa", JSON.stringify({
        defined: pts.map(function (d) { return +d.t.toFixed(3); }),
        everyDefinedHasExactlyOneArrow: pts.every(function (d) {
          return s.filter(function (x) { return Math.abs(x.t - d.t) < 1e-6; }).length === 1; })
      }));`,
    ),
  );

  // Deselect and reselect: the panel must still appear.
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  await page
    .locator(".drawing-canvas")
    .first()
    .click({ position: { x: 20, y: 20 } });
  await page.waitForTimeout(400);
  await openEdit();
  await safe("VDL panel after reselect", h.panelText);

  return out;
}

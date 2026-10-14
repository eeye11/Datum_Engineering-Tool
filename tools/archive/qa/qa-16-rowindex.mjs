import { makeHelpers, evalInPage } from "./qa-helpers.mjs";

/*
 * Calls the panel's own property-update path the way the field
 * binding does, so the model change can be observed in isolation
 * from the DOM event plumbing.
 */
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

  await h.tool("load");
  await h.sub("Varying Distributed Load");
  await h.click(0.15, 0.55);
  await h.click(0.85, 0.55);
  await h.move(0.48, 0.35);
  await h.click(0.48, 0.35);
  await h.move(0.85, 0.46);
  await h.click(0.85, 0.46);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(600);
  await h.openFeatures(0);

  await safe("panel rows", () =>
    page.evaluate(() =>
      [...document.querySelectorAll("#drawingProperties [data-property]")]
        .filter((n) => n.dataset.property.startsWith("loadPoint"))
        .map((n) => n.dataset.property + "=" + n.value),
    ),
  );

  const trace = await evalInPage(
    page,
    `
    var st = window.enggDrawing.state;
    var id = (st.selection && st.selection.selectedObjectIds || [])[0];
    var obj = null;
    st.objects.forEach(function (o) { if (o.id === id) obj = o; });
    var p = window.enggLoadProfile;

    var before = JSON.parse(JSON.stringify(p.profilePoints(obj.geometry)));

    // The panel writes: locate row 0, set its t, re-sort.
    var points = p.profilePoints(obj.geometry);
    points[0].t = 0.23;
    p.setProfilePoints(obj.geometry, points);

    document.documentElement.setAttribute("data-qa", JSON.stringify({
      before: before,
      after: p.profilePoints(obj.geometry)
    }));
  `,
  );
  await safe("model move of row 0 to 0.23", trace);

  return out;
}

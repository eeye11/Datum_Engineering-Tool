import { makeHelpers, evalInPage } from "./qa-helpers.mjs";

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

  // What does the panel actually show, row by row?
  await safe("panel rows", () =>
    page.evaluate(() =>
      [...document.querySelectorAll("#drawingProperties [data-property]")]
        .filter((n) => n.dataset.property.startsWith("loadPoint"))
        .map((n) => n.dataset.property + " = " + n.value),
    ),
  );
  await safe("model", () =>
    evalInPage(
      page,
      `
      var st = window.enggDrawing.state;
      var id = (st.selection.selectedObjectIds || [])[0];
      var o = null; st.objects.forEach(function (x) { if (x.id === id) o = x; });
      document.documentElement.setAttribute("data-qa", JSON.stringify(
        window.enggLoadProfile.profilePoints(o.geometry)));
    `,
    ),
  );

  return out;
}

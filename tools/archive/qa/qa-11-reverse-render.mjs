import { makeHelpers, evalInPage } from "./qa-helpers.mjs";

/*
 * Reads the rendered geometry of the selected feature straight out
 * of the DOM: the span line, and every arrow as its (base, tip).
 * Comparing these before and after a reversal is the only way to
 * tell an arrowhead change from a moved span.
 */
const RENDERED = `
  var g = document.querySelector('g.drawing-feature.selected')
        || document.querySelector('g.drawing-feature[data-feature-id]');
  if (!g) { document.documentElement.setAttribute("data-qa", JSON.stringify(null)); }
  else {
    var lines = [...g.querySelectorAll("line")].map(function (l) {
      return [ +(+l.getAttribute("x1")).toFixed(3), +(+l.getAttribute("y1")).toFixed(3),
               +(+l.getAttribute("x2")).toFixed(3), +(+l.getAttribute("y2")).toFixed(3) ];
    });
    var polys = [...g.querySelectorAll("polygon")].map(function (p) {
      return p.getAttribute("points");
    });
    document.documentElement.setAttribute("data-qa", JSON.stringify({ lines: lines, polys: polys }));
  }
`;

export default async function run(page) {
  const out = { steps: [] };
  const log = (s, v) => out.steps.push({ step: s, value: v });
  const safe = async (n, f) => {
    try {
      log(n, await f());
    } catch (e) {
      log(n, { error: String(e).slice(0, 200) });
    }
  };

  const h = await makeHelpers(page);
  const rendered = () => evalInPage(page, RENDERED);
  await h.category("STATICS");

  // --- Varying load with an off-grid defined point (0.37), so the
  //     reversal is checked on a load that actually has one.
  await h.tool("load");
  await h.sub("Varying Distributed Load");
  await h.click(0.15, 0.55);
  await h.click(0.85, 0.55);
  await h.move(0.48, 0.35);
  await h.click(0.48, 0.35);
  await h.move(0.85, 0.46);
  await h.click(0.85, 0.46);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(500);

  const vb = await h.selected();
  await safe("varying geometry before", () => vb.geometry);
  await safe("varying rendered before", rendered);

  await h.openFeatures(0);
  await page.locator("[data-load-reverse-direction]").click();
  await page.waitForTimeout(600);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  const va = await h.selected();
  await safe("varying geometry after", () => va.geometry);
  await safe("varying rendered after", rendered);

  await safe(
    "varying: span identical",
    () =>
      JSON.stringify(va.geometry.start) === JSON.stringify(vb.geometry.start) &&
      JSON.stringify(va.geometry.end) === JSON.stringify(vb.geometry.end),
  );
  await safe(
    "varying: points identical",
    () =>
      JSON.stringify(va.geometry.points) === JSON.stringify(vb.geometry.points),
  );

  return out;
}

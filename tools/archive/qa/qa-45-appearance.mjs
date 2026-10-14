import { makeHelpers, evalInPage } from "./qa-helpers.mjs";

/*
 * Section 15, part 5: appearance.
 *
 * Reads the ACTUAL stroke widths and arrowhead sizes off the
 * rendered SVG, so the claim is about what is drawn rather than
 * about what is stored. Style is applied through the same public
 * entry point the Features panel's controls use, so the values
 * are the ones a user would set.
 */
const READ = `
  var st = window.enggDrawing.state;
  var id = (st.selection && st.selection.selectedObjectIds || [])[0];
  var f = null;
  st.objects.forEach(function (o) { if (o.id === id) f = o; });
  var g = document.querySelector('g.drawing-feature.selected');

  var lines = g ? [...g.querySelectorAll("line")] : [];
  var heads = g ? [...g.querySelectorAll("polygon")] : [];

  document.documentElement.setAttribute("data-qa", JSON.stringify({
    type: f ? f.type : null,
    storedLineWidth: f && f.style ? f.style.lineWidth : null,
    storedLineType: f && f.style ? f.style.lineType : null,
    strokeWidths: lines.map(function (l) { return +l.getAttribute("stroke-width"); }),
    dasharrays: lines.map(function (l) { return l.getAttribute("stroke-dasharray"); }),
    headSizes: heads.map(function (p) {
      var pts = p.getAttribute("points").split(" ");
      var t = pts[0].split(",").map(Number);
      var a = pts[1].split(",").map(Number);
      return +Math.hypot(t[0] - a[0], t[1] - a[1]).toFixed(2);
    })
  }));
`;

const SET_STYLE = `
  var st = window.enggDrawing.state;
  var id = (st.selection && st.selection.selectedObjectIds || [])[0];
  var f = null;
  st.objects.forEach(function (o) { if (o.id === id) f = o; });
  if (!f) { document.documentElement.setAttribute("data-qa", JSON.stringify({ missing: true })); }
  else {
    f.style = Object.assign({}, f.style);
    f.style.lineWidth = %WIDTH%;
    f.style.lineType = "%TYPE%";
    st.commitDrawingChange ? st.commitDrawingChange() : null;
    window.enggDrawing.renderer.render(window.enggDrawing.state);
    document.documentElement.setAttribute("data-qa", JSON.stringify({ set: true }));
  }
`;

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

  const setStyle = async (width, type) => {
    await evalInPage(
      page,
      SET_STYLE.replace("%WIDTH%", width).replace("%TYPE%", type),
    );
    await page.waitForTimeout(400);
  };

  const read = () => evalInPage(page, READ);

  // --- Point Force default thickness.
  await h.tool("point-force");
  await h.click(0.3, 0.3);
  await h.click(0.55, 0.18);
  await page.waitForTimeout(600);
  await safe("force default", read);

  // Thicker: shaft and head must both grow.
  await setStyle(4, "solid");
  await safe("force lineWidth 4", read);

  // Thinner: both must shrink.
  await setStyle(0.5, "solid");
  await safe("force lineWidth 0.5", read);

  // Line type must reach the drawing.
  await setStyle(2, "dashed");
  await safe("force dashed", read);
  await setStyle(2, "center");
  await safe("force centre", read);

  // --- Distributed Load: same appearance treatment.
  await h.tool("load");
  await h.sub("Distributed Load");
  await h.click(0.15, 0.55);
  await h.click(0.85, 0.55);
  await h.move(0.45, 0.4);
  await h.click(0.45, 0.4);
  await page.waitForTimeout(600);
  await safe("load default", read);
  await setStyle(4, "solid");
  await safe("load lineWidth 4", read);
  await setStyle(0.5, "solid");
  await safe("load lineWidth 0.5", read);
  await setStyle(1, "dashed");
  await safe("load dashed", read);

  return out;
}

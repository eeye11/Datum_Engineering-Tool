import { makeHelpers } from "./qa-helpers.mjs";

/*
 * ONE pointer move, measured.
 *
 * The drag must place the dimension's placement at the SAME world point the
 * pointer is at, offset by where it was grabbed. A single clean move makes
 * that measurable: the world delta must equal the pointer's world delta.
 */
export default async function run(page) {
  const out = {};
  const h = await makeHelpers(page);

  const at = (fx, fy) => h.at(fx, fy);

  const state = () =>
    h.evalInPage(
      page,
      `
      var st = window.enggDrawing.state;
      var d = null;
      st.objects.forEach(function (o) { if (o.type === "dimension") d = o; });
      var cam = st.camera;
      document.documentElement.setAttribute("data-qa", JSON.stringify({
        placement: d ? { x: d.placement.x, y: d.placement.y } : null,
        zoom: cam.zoom, panX: cam.panX, panY: cam.panY
      }));`,
    );

  const textRect = () =>
    h.evalInPage(
      page,
      `
      var t = Array.from(document.querySelectorAll(".drawing-canvas svg text"))
        .find(function (x) { return /mm/.test(x.textContent); });
      if (!t) { document.documentElement.setAttribute("data-qa", JSON.stringify(null)); }
      else {
        var r = t.getBoundingClientRect();
        document.documentElement.setAttribute("data-qa", JSON.stringify({
          cx: r.x + r.width / 2, cy: r.y + r.height / 2
        }));
      }`,
    );

  await h.category("GEOMETRY");
  await h.tool("line");

  const a = at(0.25, 0.55);
  const b = at(0.65, 0.55);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(300);

  await h.category("ANNOTATE");
  await h.tool("smart-dimension");
  const p = at(0.45, 0.55);
  await page.mouse.click(p.x, p.y);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(300);
  const q = at(0.45, 0.42);
  await page.mouse.click(q.x, q.y);
  await page.waitForTimeout(400);

  out.before = await state();
  const t = await textRect();
  out.text = t;

  if (!t) {
    return out;
  }

  // Press on the text, then move ONE step of exactly 40 px right / 20 px down.
  await page.mouse.move(t.cx, t.cy);
  await page.waitForTimeout(150);
  await page.mouse.down();
  await page.mouse.move(t.cx + 40, t.cy + 20, { steps: 1 });
  await page.waitForTimeout(200);

  out.afterOneMove = await state();
  out.oneMoveDelta = {
    x:
      Math.round(
        (out.afterOneMove.placement.x - out.before.placement.x) * 100,
      ) / 100,
    y:
      Math.round(
        (out.afterOneMove.placement.y - out.before.placement.y) * 100,
      ) / 100,
  };

  await page.mouse.up();
  await page.waitForTimeout(200);

  return out;
}

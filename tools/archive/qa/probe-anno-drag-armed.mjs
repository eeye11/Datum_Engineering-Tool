import { makeHelpers } from "./qa-helpers.mjs";

/*
 * With a CREATION tool still armed, a press on an annotation's text must
 * MOVE the label, not start a new feature.
 */
export default async function run(page) {
  const out = { steps: [] };
  const log = (s, v) => out.steps.push({ step: s, value: v });
  const safe = async (n, f) => {
    try {
      log(n, await f());
    } catch (e) {
      log(n, { error: String(e).slice(0, 400) });
    }
  };

  const h = await makeHelpers(page);

  const probe = () =>
    h.evalInPage(
      page,
      `
      var st = window.enggDrawing.state;
      var t = document.querySelector(".drawing-derived-magnitude text");
      document.documentElement.setAttribute("data-qa", JSON.stringify({
        activeTool: st.activeTool,
        phase: st.interaction && st.interaction.phase,
        selected: (st.selection && st.selection.selectedObjectIds) || [],
        objects: st.objects.length,
        textRect: t ? (function () {
          var r = t.getBoundingClientRect();
          return { x: Math.round(r.x), y: Math.round(r.y) };
        })() : null
      }));`,
    );

  await h.category("STATICS");
  await h.tool("point-force");

  const a = h.at(0.3, 0.5);
  const b = h.at(0.5, 0.35);

  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(400);

  await safe("after-force", async () => await probe());

  /*
   * The Point Force tool is STILL ARMED here - deliberately, so the press on
   * the annotation has to be intercepted by the annotation drag rather than
   * falling through to feature creation.
   */
  const before = await h.evalInPage(
    page,
    `
    var t = document.querySelector(".drawing-derived-magnitude text");
    if (!t) { document.documentElement.setAttribute("data-qa", "null"); }
    else {
      var r = t.getBoundingClientRect();
      document.documentElement.setAttribute("data-qa", JSON.stringify({
        cx: r.x + r.width / 2, cy: r.y + r.height / 2
      }));
    }`,
  );

  out.before = before;

  // Press directly on the text and drag it 70px right, 40px up.
  await page.mouse.move(before.cx, before.cy);
  await page.waitForTimeout(150);
  await page.mouse.down();
  await page.mouse.move(before.cx + 70, before.cy - 40, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(400);

  await safe("after-drag-with-tool-armed", async () => await probe());

  return out;
}

import { makeHelpers } from "./qa-helpers.mjs";

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
      document.documentElement.setAttribute("data-qa", JSON.stringify({
        activeTool: st.activeTool,
        phase: st.interaction && st.interaction.phase,
        selected: (st.selection && st.selection.selectedObjectIds) || [],
        objects: st.objects.length
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

  // A REAL selection first: switch to the Select tool.
  await h.tool("select");
  await page.waitForTimeout(200);

  await safe("after-select-tool", async () => await probe());

  const textBox = await h.evalInPage(
    page,
    `
    var t = document.querySelector(".drawing-derived-magnitude text");
    if (!t) { document.documentElement.setAttribute("data-qa", "null"); }
    else {
      var r = t.getBoundingClientRect();
      document.documentElement.setAttribute("data-qa", JSON.stringify({
        cx: r.x + r.width / 2, cy: r.y + r.height / 2, text: t.textContent
      }));
    }`,
  );

  out.textBox = textBox;

  // Click to select, then drag from the same point.
  await page.mouse.move(textBox.cx, textBox.cy);
  await page.mouse.click(textBox.cx, textBox.cy);
  await page.waitForTimeout(300);
  await safe("after-click", async () => await probe());

  await page.mouse.move(textBox.cx, textBox.cy);
  await page.mouse.down();
  await page.mouse.move(textBox.cx + 80, textBox.cy - 50, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(400);

  await safe("after-drag", async () => await probe());

  return out;
}

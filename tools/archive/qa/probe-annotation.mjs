import { makeHelpers } from "./qa-helpers.mjs";

/*
 * Measures the annotation selection box against the text it wraps, and
 * exercises a direct click-and-drag on the annotation text.
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

  const boxes = () =>
    h.evalInPage(
      page,
      `
      var st = window.enggDrawing.state;
      var boxEls = document.querySelectorAll(".drawing-annotation-selection-box");
      var texts = document.querySelectorAll(".drawing-derived-magnitude text");
      document.documentElement.setAttribute("data-qa", JSON.stringify({
        selected: (st.selection && st.selection.selectedObjectIds) || [],
        annotationBoxes: [...boxEls].map(function (b) {
          return {
            x: Number(b.getAttribute("x")),
            y: Number(b.getAttribute("y")),
            w: Number(b.getAttribute("width")),
            h: Number(b.getAttribute("height"))
          };
        }),
        annotationTexts: [...texts].map(function (t) {
          var r = t.getBoundingClientRect();
          return { text: t.textContent, w: Math.round(r.width), h: Math.round(r.height) };
        })
      }));`,
    );

  // Make a Point Force, which carries a magnitude annotation by default.
  await h.category("STATICS");
  await h.tool("point-force");

  const a = h.at(0.3, 0.5);
  const b = h.at(0.5, 0.35);

  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(500);

  await safe("after-force", async () => await boxes());

  /*
   * Find the annotation text's screen position by reading it from the DOM,
   * then click exactly there.
   */
  const textBox = await h.evalInPage(
    page,
    `
    var t = document.querySelector(".drawing-derived-magnitude text");
    if (!t) { document.documentElement.setAttribute("data-qa", "null"); }
    else {
      var r = t.getBoundingClientRect();
      document.documentElement.setAttribute("data-qa", JSON.stringify({
        cx: r.x + r.width / 2,
        cy: r.y + r.height / 2,
        x: r.x, y: r.y, w: r.width, h: r.height,
        text: t.textContent
      }));
    }`,
  );

  out.annotationText = textBox;

  if (!textBox) {
    return out;
  }

  // Click directly on the annotation text.
  await page.mouse.click(textBox.cx, textBox.cy);
  await page.waitForTimeout(350);

  await safe("after-click-annotation", async () => await boxes());

  // Drag it: press on the text, move, release.
  await page.mouse.move(textBox.cx, textBox.cy);
  await page.mouse.down();
  await page.mouse.move(textBox.cx + 60, textBox.cy - 40, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(400);

  await safe("after-drag-annotation", async () => await boxes());

  return out;
}

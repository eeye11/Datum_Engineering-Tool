/*
 * Verify the top style strip (Thickness / Color / Line Type / toggles) never
 * overlaps and reflows onto a second line instead of colliding.
 *
 * The check is geometric: read each control's bounding box and assert that
 * no two boxes intersect, at several widths, and that the strip grows to two
 * rows when it needs to.
 */
export default async function run(page) {
  const errs = [];
  page.on("pageerror", (e) => errs.push("PAGEERROR: " + e.message.slice(0, 220)));
  page.on("console", (m) => {
    if (m.type() === "error") errs.push("CONSOLE: " + m.text().slice(0, 180));
  });

  await page.evaluate(async () => {
    await import("/src/main.js");
  });
  await page.waitForFunction(
    () => !!(window.enggDrawing && window.enggDrawing.state),
    { timeout: 15000 },
  );

  const tab = page
    .locator("button", { hasText: "Engineering Drawing" })
    .first();
  if (await tab.count()) await tab.click();
  await page.waitForTimeout(900);
  const measure = () =>
    page.evaluate(() => {
      const strip = document.querySelector(".drawing-style-strip");

      // Each direct child is one control (a label+input pair, or a toggle).
      const items = [...strip.children].map((el) => {
        const r = el.getBoundingClientRect();
        return {
          text: (el.textContent || "").trim().slice(0, 22),
          x: Math.round(r.x),
          y: Math.round(r.y),
          w: Math.round(r.width),
          h: Math.round(r.height),
        };
      });

      // Any genuine overlap between two controls.
      const overlaps = [];
      for (let i = 0; i < items.length; i += 1) {
        for (let j = i + 1; j < items.length; j += 1) {
          const a = items[i];
          const b = items[j];
          const hit =
            a.x < b.x + b.w &&
            b.x < a.x + a.w &&
            a.y < b.y + b.h &&
            b.y < a.y + a.h;
          if (hit) overlaps.push([a.text, b.text]);
        }
      }

      // How many ROWS the controls occupy (distinct y positions).
      const rows = new Set(items.map((i) => i.y)).size;

      const stripRect = strip.getBoundingClientRect();

      return {
        items,
        overlaps,
        rows,
        stripHeight: Math.round(stripRect.height),
        // Is any control given less width than its own content needs?
        clipped: items.filter((i) => i.w < 20).map((i) => i.text),
      };
    });

  const out = { errs, byWidth: {} };

  for (const width of [1400, 1100, 900, 760, 640, 520, 430, 380]) {
    await page.setViewportSize({ width, height: 820 });
    await page.waitForTimeout(400);
    out.byWidth[width] = await measure();
  }

  return out;
}

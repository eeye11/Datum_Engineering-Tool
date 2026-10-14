import { makeHelpers } from "./qa-helpers.mjs";

/*
 * CLICK + HOLD -> DRAG -> RELEASE must still create the feature, and must
 * commit it on the release with no second click and no trailing construction.
 *
 * This is the workflow the deferred start in creation-drag.js had to preserve:
 * the press no longer builds anything, so the feature is begun when the pointer
 * first crosses the drag threshold and completed on the release.
 */
export default async function run(page) {
  const errs = [];

  page.on("pageerror", (e) =>
    errs.push("PAGEERROR: " + e.message.slice(0, 220)),
  );
  page.on("console", (m) => {
    if (m.type() === "error") errs.push("CONSOLE: " + m.text().slice(0, 180));
  });

  const out = { errs };

  await page.evaluate(async () => {
    await import("/src/main.js");
  });
  await page.waitForTimeout(800);

  const h = await makeHelpers(page);
  const at = (fx, fy) => h.at(fx, fy);

  await h.category("GEOMETRY");
  await h.tool("line");

  const a = at(0.25, 0.6);
  const b = at(0.68, 0.38);

  await page.mouse.move(a.x, a.y);
  await page.waitForTimeout(120);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 12 });
  await page.waitForTimeout(150);
  await page.mouse.up();
  await page.waitForTimeout(350);

  out.popupAfterDrag = await page
    .locator(".drawing-creation-dimension")
    .count();
  out.msgAfterDrag = await h.msg();

  await page.keyboard.press("Enter");
  await page.waitForTimeout(450);

  out.lines = await page.evaluate(() =>
    window.enggDrawing.state.objects
      .filter((o) => o.type === "line")
      .map((o) => ({
        start: o.geometry.start,
        end: o.geometry.end,
      })),
  );

  out.phase = await page.evaluate(
    () => window.enggDrawing.state.interaction.phase,
  );

  return out;
}

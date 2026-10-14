/*
 * Leave the Tools menu OPEN (with an item hovered) so a screenshot can be taken of
 * the real rendered dropdown. Run through a browser session, screenshot, then
 * switch the theme and screenshot again.
 *
 * A colour-scheme query parameter picks the theme, so one script serves both
 * captures.
 */
export default async function run(page) {
  const errs = [];

  page.on("pageerror", (e) =>
    errs.push("PAGEERROR: " + e.message.slice(0, 220)),
  );
  page.on("console", (m) => {
    if (m.type() === "error") errs.push("CONSOLE: " + m.text().slice(0, 180));
  });

  const theme = /theme=dark/.test(page.url()) ? "dark" : "light";

  await page.evaluate(async () => {
    await import("/src/main.js");
  });
  await page.waitForTimeout(900);

  /*
   * THE DRAWING TAB, because the menu bar lives on it. The application opens on
   * Written Solution, where there is no `#datumMenuBar` at all - which is why the
   * Tools button was never found.
   */
  const tab = page.getByRole("button", { name: "Engineering Drawing" });
  if (await tab.count()) {
    await tab.first().click();
    await page.waitForTimeout(1200);
  }

  /* Select a feature so the draw-order items are enabled, not greyed out. */
  await page.evaluate(async () => {
    const st = window.enggDrawing.state;
    const D = window.enggDrawingState;

    st.objects.length = 0;
    st.selection.selectedObjectIds = [];

    const line = D.geometryFactories.line({ x: 0, y: 0 }, { x: 90, y: 40 });
    D.addObject(st, line);
    st.selection.selectedObjectIds = [line.id];
  });

  await page.evaluate(async (want) => {
    document.documentElement.setAttribute("data-theme", want);
    await new Promise((r) => requestAnimationFrame(r));
  }, theme);

  await page.waitForTimeout(250);

  /* Open Tools through the application's own menu bar. */
  const button = page
    .locator("#datumMenuBar button", { hasText: "Tools" })
    .first();
  await button.click();
  await page.waitForTimeout(300);

  /* Hover a real item so the hover surface is captured. */
  const items = page.locator(".datum-menu-panel .datum-menu-item");
  if (await items.count()) {
    await items.nth(4).hover();
    await page.waitForTimeout(250);
  }

  return { errs, theme };
}

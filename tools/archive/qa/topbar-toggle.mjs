/*
 * Measure the workspace before and after hiding the top bar, so we can see
 * exactly WHAT moves - buttons, panels, the canvas - rather than guessing.
 */
export default async function run(page) {
  const errs = [];
  page.on("pageerror", (e) =>
    errs.push("PAGEERROR: " + e.message.slice(0, 220)),
  );
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

  const snap = () =>
    page.evaluate(() => {
      const rect = (sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return {
          x: Math.round(r.x),
          y: Math.round(r.y),
          w: Math.round(r.width),
          h: Math.round(r.height),
        };
      };
      return {
        header: rect(".header"),
        tabs: rect(".tabs"),
        toolbar: rect(".drawing-app-toolbar"),
        sectionBar: rect(".drawing-toolbar"),
        showStrip: rect("#drawingTopBarShow"),
        canvas: rect(".drawing-canvas"),
        canvasArea: rect(".drawing-canvas-area"),
        toolRail: rect(".drawing-panel-rail-left"),
        toolToggle: rect("#drawingToolPanelToggle"),
        featuresRail: rect(".drawing-panel-rail-right"),
        featuresToggle: rect("#drawingFeaturesPanelToggle"),
        sheetBar: rect(".drawing-sheet-bar-row"),
        statusBar: rect(".drawing-status-bar"),
        workspace: rect(".drawing-workspace"),
      };
    });

  const out = { errs };
  out.visible = await snap();

  await page.locator("#headerHideButton").click();
  await page.waitForTimeout(500);

  out.hidden = await snap();

  return out;
}

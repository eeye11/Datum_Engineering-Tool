/*
 * Diagnose why the triangle clicks did nothing: check the tool activated,
 * where the projected points are, and whether the hit test finds the triangle
 * at those points.
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

  const out = { errs };

  out.toolButtonCount = await page
    .locator('#drawingToolList [data-tool-id="smart-dimension"]')
    .count();

  await page.locator('button[data-category="ANNOTATE"]').click();
  await page.waitForTimeout(300);

  out.toolButtonCountAfterCategory = await page
    .locator('#drawingToolList [data-tool-id="smart-dimension"]')
    .count();

  await page
    .locator('#drawingToolList [data-tool-id="smart-dimension"]')
    .first()
    .click();
  await page.waitForTimeout(300);

  out.activeTool = await page.evaluate(
    () => window.enggDrawing.state.activeTool,
  );

  out.probe = await page.evaluate(() => {
    const st = window.enggDrawing.state;
    const D = window.enggDrawingState;

    st.objects.length = 0;
    st.selection.selectedObjectIds = [];

    const A = { x: 0, y: 0 };
    const B = { x: 40, y: 0 };
    const C = { x: 0, y: 30 };

    const triangle = D.geometryFactories.triangle([A, B, C]);
    D.addObject(st, triangle);

    const bounds = document
      .querySelector(".drawing-canvas")
      .getBoundingClientRect();

    const toScreen = (p) => D.engineeringToScreen(p, bounds, st);

    const midAB = { x: 20, y: 0 };
    const screenAB = toScreen(midAB);

    return {
      canvas: {
        x: Math.round(bounds.x),
        y: Math.round(bounds.y),
        w: Math.round(bounds.width),
        h: Math.round(bounds.height),
      },
      midABWorld: midAB,
      midABScreen: {
        x: Math.round(screenAB.x),
        y: Math.round(screenAB.y),
      },
      insideCanvas:
        screenAB.x >= bounds.x &&
        screenAB.x <= bounds.right &&
        screenAB.y >= bounds.y &&
        screenAB.y <= bounds.bottom,
    };
  });

  return out;
}

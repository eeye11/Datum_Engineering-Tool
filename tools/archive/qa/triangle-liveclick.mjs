/*
 * Click the projected point with a REAL mouse event and report the interaction
 * state, so the live path is tested end to end.
 */
export default async function run(page) {
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

  const point = await page.evaluate(() => {
    const st = window.enggDrawing.state;
    const D = window.enggDrawingState;

    st.objects.length = 0;

    const triangle = D.geometryFactories.triangle([
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 0, y: 30 },
    ]);

    D.addObject(st, triangle);

    const bounds = document
      .querySelector(".drawing-canvas")
      .getBoundingClientRect();

    const p = D.engineeringToScreen({ x: 20, y: 0 }, bounds, st);

    return { x: p.x, y: p.y };
  });

  await page.locator('button[data-category="ANNOTATE"]').click();
  await page.waitForTimeout(250);
  await page
    .locator('#drawingToolList [data-tool-id="smart-dimension"]')
    .first()
    .click();
  await page.waitForTimeout(250);

  await page.mouse.move(point.x, point.y);
  await page.waitForTimeout(120);
  await page.mouse.click(point.x, point.y);
  await page.waitForTimeout(400);

  return page.evaluate((p) => {
    const i = window.enggDrawing.state.interaction;

    return {
      clickedAt: { x: Math.round(p.x), y: Math.round(p.y) },
      activeTool: window.enggDrawing.state.activeTool,
      stage: i.dimensionStage,
      choice: i.dimensionChoice,
      picked: (i.dimensionPickedRefs || []).map((r) => r.anchor),
    };
  }, point);
}

/*
 * What element is actually at the click point, and does a dispatched click
 * reach the canvas's own listener?
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

  const probe = await page.evaluate(() => {
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

    const element = document.elementFromPoint(p.x, p.y);

    return {
      point: { x: Math.round(p.x), y: Math.round(p.y) },
      elementTag: element ? element.tagName : null,
      elementClass: element ? element.className : null,
      canvasContains: element
        ? document.querySelector(".drawing-canvas").contains(element)
        : false,
      activeTool: st.activeTool,
    };
  });

  /* Dispatch a real click at the point and see whether the tool reacts. */
  await page.locator('button[data-category="ANNOTATE"]').click();
  await page.waitForTimeout(250);
  await page
    .locator('#drawingToolList [data-tool-id="smart-dimension"]')
    .first()
    .click();
  await page.waitForTimeout(250);

  await page.mouse.click(probe.point.x, probe.point.y);
  await page.waitForTimeout(350);

  const after = await page.evaluate(() => {
    const i = window.enggDrawing.state.interaction;
    return {
      stage: i.dimensionStage,
      choice: i.dimensionChoice,
      activeTool: window.enggDrawing.state.activeTool,
    };
  });

  return { probe, after };
}

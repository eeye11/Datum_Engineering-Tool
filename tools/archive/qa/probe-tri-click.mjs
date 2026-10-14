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

  /* Activate Smart Dimension through the real tool button. */
  await page.locator('button[data-category="ANNOTATE"]').click();
  await page.waitForTimeout(250);
  await page
    .locator('#drawingToolList [data-tool-id="smart-dimension"]')
    .first()
    .click();
  await page.waitForTimeout(250);

  const out = {};

  out.tool = await page.evaluate(() => window.enggDrawing.state.activeTool);

  /* Build the triangle now, AFTER the tool is armed. */
  const screen = await page.evaluate(() => {
    const st = window.enggDrawing.state;
    const D = window.enggDrawingState;

    st.objects.length = 0;
    st.selection.selectedObjectIds = [];

    const t = D.geometryFactories.triangle([
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 0, y: 30 },
    ]);

    D.addObject(st, t);

    const bounds = document
      .querySelector(".drawing-canvas")
      .getBoundingClientRect();

    const p = D.engineeringToScreen({ x: 20, y: 2 }, bounds, st);

    return { x: p.x, y: p.y };
  });

  out.screen = screen;
  out.toolAfterBuild = await page.evaluate(
    () => window.enggDrawing.state.activeTool,
  );

  await page.mouse.click(screen.x, screen.y);
  await page.waitForTimeout(400);

  out.interaction = await page.evaluate(() => {
    const i = window.enggDrawing.state.interaction;

    return {
      stage: i.dimensionStage,
      choice: i.dimensionChoice,
      phase: i.phase,
      tool: window.enggDrawing.state.activeTool,
      selected: window.enggDrawing.state.selection.selectedObjectIds,
    };
  });

  return out;
}

export default async function run(page, ui) {
  // 1. Does the harness capture console errors AT ALL? Prove the channel
  //    works before trusting a "0 console errors" report about the app.
  await page.evaluate(() => {
    console.error("HARNESS-PROBE: deliberate");
  });
  await page.waitForTimeout(300);

  // 2. Did the browser actually fetch and execute the scripts?
  const resources = await page.evaluate(() =>
    performance
      .getEntriesByType("resource")
      .filter((e) => e.name.includes("engineering-drawing"))
      .map((e) => ({
        file: e.name.split("/").pop(),
        size: e.transferSize,
        status: e.responseStatus,
      })),
  );

  // 3. Does one script's own side effect exist?
  const probe = await page.evaluate(() => ({
    // drawing.js defines these as globals by name
    staticsTypes: typeof window.STATICS_PREVIEW_TYPES,
    // quantities.js
    quantityUnit: typeof window.enggQuantities?.unitOf,
    // drawing-state.js
    drawingStateModule: typeof window.enggDrawingState,
    // renderer.js
    renderer: typeof window.enggDrawingRenderer,
    // ui.js / drawing.js
    renderCurrentDrawing: typeof window.renderCurrentDrawing,
    showTab: typeof window.showTab,
  }));

  return { resourceCount: resources.length, resources, probe };
}

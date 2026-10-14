/*
 * Confirm the application's forward and inverse projections agree, by
 * round-tripping a world point through the SAME projector the click path uses.
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

  return page.evaluate(() => {
    const st = window.enggDrawing.state;
    const D = window.enggDrawingState;

    const canvas = document.querySelector(".drawing-canvas");
    const bounds = canvas.getBoundingClientRect();

    const world = { x: 20, y: 0 };

    const screen = D.engineeringToScreen(world, bounds, st);

    /*
     * The inverse the CLICK path uses. `screenToEngineering` is the model's
     * own, and it takes the same bounds.
     */
    const back = D.screenToEngineering(screen, bounds, st);

    return {
      world,
      screen: { x: Math.round(screen.x), y: Math.round(screen.y) },
      back: { x: Math.round(back.x), y: Math.round(back.y) },
      roundTrips:
        Math.abs(back.x - world.x) < 0.5 && Math.abs(back.y - world.y) < 0.5,
      camera: {
        zoom: st.camera.zoom,
        panX: Math.round(st.camera.panX),
        panY: Math.round(st.camera.panY),
      },
    };
  });
}

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

  /* A round trip: world -> screen -> world must return the same point. */
  return page.evaluate(() => {
    const st = window.enggDrawing.state;
    const D = window.enggDrawingState;

    st.objects.length = 0;

    const canvas = document.querySelector(".drawing-canvas");
    const bounds = canvas.getBoundingClientRect();

    const world = { x: 20, y: 2 };

    const screen = D.engineeringToScreen(world, bounds, st);

    /* The inverse the event path uses. */
    const back = D.screenToEngineering
      ? D.screenToEngineering(screen, bounds, st)
      : null;

    return {
      bounds: {
        x: Math.round(bounds.x),
        y: Math.round(bounds.y),
        w: Math.round(bounds.width),
        h: Math.round(bounds.height),
      },
      camera: {
        zoom: st.camera.zoom,
        panX: st.camera.panX,
        panY: st.camera.panY,
      },
      world,
      screen: { x: Math.round(screen.x), y: Math.round(screen.y) },
      back: back ? { x: Math.round(back.x), y: Math.round(back.y) } : null,
    };
  });
}

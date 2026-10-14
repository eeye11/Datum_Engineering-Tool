/*
 * Fluids route QA - snapping, persistence, and model-level verification in the
 * live page. Reads the REAL document via the automation hooks.
 */
export default async function run(page, ui) {
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: "Engineering Drawing" }).click();
  await page.waitForTimeout(600);

  const out = {};

  const switchFluids = async () => {
    await page.evaluate(() => {
      [...document.querySelectorAll(".drawing-category")]
        .find((el) => el.dataset.category === "FLUIDS")
        ?.click();
    });
    await page.waitForTimeout(200);
  };

  const svgBox = await page.evaluate(() => {
    const svg = document.querySelector(".drawing-canvas svg");
    const b = svg.getBoundingClientRect();
    return { x: b.x, y: b.y, width: b.width, height: b.height };
  });
  const cx = svgBox.x + svgBox.width / 2;
  const cy = svgBox.y + svgBox.height / 2;

  const objects = () =>
    page.evaluate(() =>
      (window.enggDrawingState?.objects || []).map((o) => ({
        id: o.id,
        type: o.type,
        parentId: o.parentId || null,
        name: o.name,
        points: o.geometry?.points?.length || 0,
        routeIndex: o.engineering?.routeIndex,
      })),
    );

  /* ---- Draw a first route. ---- */
  await switchFluids();
  await page.evaluate(() => {
    document.querySelector('.drawing-tool[data-tool-id="pipe-duct"]')?.click();
  });
  await page.waitForTimeout(200);

  for (const [x, y] of [
    [cx - 200, cy - 120],
    [cx + 40, cy - 120],
  ]) {
    await page.mouse.click(x, y);
    await page.waitForTimeout(180);
  }
  await page.keyboard.press("Enter");
  await page.waitForTimeout(400);

  const afterFirst = await objects();
  out.firstRoute = afterFirst;

  /* The first route's END in world coordinates, so we can snap to it. */
  const endWorld = await page.evaluate(() => {
    const route = window.enggDrawingState.objects.find(
      (o) => o.type === "pipe-route",
    );
    return route ? route.geometry.end : null;
  });
  out.endWorld = endWorld;

  /* Screen position of that world point, via the app's own transform. */
  const endScreen = await page.evaluate((world) => {
    const svg = document.querySelector(".drawing-canvas svg");
    const b = svg.getBoundingClientRect();
    const camera = window.enggDrawingState.camera || { x: 0, y: 0, zoom: 1 };
    const viewBox = svg.viewBox.baseVal;
    // world -> svg user units -> screen
    const zoom = camera.zoom || 1;
    const ux = (world.x - (camera.x || 0)) * zoom + viewBox.width / 2;
    const uy = (world.y - (camera.y || 0)) * zoom + viewBox.height / 2;
    const sx = b.x + (ux / viewBox.width) * b.width;
    const sy = b.y + (uy / viewBox.height) * b.height;
    return { sx, sy, camera, viewBox: { w: viewBox.width, h: viewBox.height } };
  }, endWorld);
  out.endScreen = endScreen;

  /* ---- Draw a SECOND route whose start snaps onto the first's end. ---- */
  await switchFluids();
  await page.evaluate(() => {
    document.querySelector('.drawing-tool[data-tool-id="pipe-duct"]')?.click();
  });
  await page.waitForTimeout(200);

  // Click a few px away from the exact endpoint, so a snap must be involved.
  await page.mouse.click(endScreen.sx + 3, endScreen.sy + 3);
  await page.waitForTimeout(200);
  await page.mouse.click(endScreen.sx + 120, endScreen.sy + 80);
  await page.waitForTimeout(200);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(400);

  const afterSecond = await objects();
  out.secondRoute = afterSecond;

  /* Did the second route's start land EXACTLY on the first's end? */
  out.snapResult = await page.evaluate(() => {
    const routes = window.enggDrawingState.objects.filter(
      (o) => o.type === "pipe-route",
    );
    if (routes.length < 2) return { routes: routes.length };
    const a = routes[0].geometry.end;
    const b = routes[1].geometry.start;
    return {
      a,
      b,
      exactMatch: a.x === b.x && a.y === b.y,
      distance: Math.hypot(a.x - b.x, a.y - b.y),
    };
  });

  /* ---- Persistence: serialize the document and read it back. ---- */
  out.persistence = await page.evaluate(() => {
    const state = window.enggDrawingState;
    const saved = state.serializeDrawing(state);
    const parsed = JSON.parse(saved);
    const restored = parsed.objects || [];
    const route = restored.find((o) => o.type === "pipe-route");
    const children = restored.filter((o) => o.parentId);
    return {
      savedLength: saved.length,
      routeCount: restored.filter((o) => o.type === "pipe-route").length,
      segmentCount: restored.filter((o) => o.type === "pipe-segment").length,
      elbowCount: restored.filter((o) => o.type === "pipe-elbow").length,
      routePoints: route?.geometry?.points?.length || 0,
      childParentsResolve: children.every((c) =>
        restored.some((r) => r.id === c.parentId),
      ),
      routeEngineering: route?.engineering || null,
    };
  });

  return out;
}

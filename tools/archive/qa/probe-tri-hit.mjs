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

  return page.evaluate(async () => {
    const st = window.enggDrawing.state;
    const D = window.enggDrawingState;

    st.objects.length = 0;
    st.selection.selectedObjectIds = [];

    const A = { x: 0, y: 0 };
    const B = { x: 40, y: 0 };
    const C = { x: 0, y: 30 };

    const triangle = D.geometryFactories.triangle([A, B, C]);
    D.addObject(st, triangle);

    const canvas = document.querySelector(".drawing-canvas");
    const bounds = canvas.getBoundingClientRect();

    const hitTesting = await import("/src/editor/hit-testing.js");
    const inference = await import("/src/editor/dimension-inference.js");

    const mid = (p, q) => ({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 });

    /* A world point on side AB, a touch inside. */
    const onAB = { x: 20, y: 2 };

    /* The SCREEN point, and what the app says is under it. */
    const screen = D.engineeringToScreen(onAB, bounds, st);

    const found = hitTesting.objectAtPoint(onAB);
    const target = hitTesting.findDimensionTarget ? null : null;

    /* What the dimension reference resolution makes of that point. */
    let reference = "n/a";

    try {
      const dimTool = await import("/src/editor/dimension-tool.js");
      const t = dimTool.findDimensionTarget(onAB);
      reference = t ? { type: t.type, id: t.id } : null;
    } catch (e) {
      reference = String(e.message);
    }

    let refAt = "n/a";

    try {
      refAt = inference.dimensionReferenceAtClick({}, onAB, false);
    } catch (e) {
      refAt = String(e.message);
    }

    return {
      canvas: {
        x: Math.round(bounds.x),
        y: Math.round(bounds.y),
        w: Math.round(bounds.width),
        h: Math.round(bounds.height),
      },
      triangleGeometry: triangle.geometry,
      screenPoint: { x: Math.round(screen.x), y: Math.round(screen.y) },
      objectAtPoint: found ? { type: found.type, id: found.id } : null,
      dimensionTarget: reference,
      referenceAtClick: refAt,
    };
  });
}

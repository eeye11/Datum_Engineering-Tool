/*
 * What does the pointer resolver produce for a click on a triangle side, and
 * what does the dimension inference make of it?
 */
export default async function run(page) {
  await page.evaluate(async () => {
    await import("/src/main.js");
  });
  await page.waitForFunction(
    () => !!(window.enggDrawing && window.enggDrawing.state),
    { timeout: 15000 },
  );

  await page.evaluate(async () => {
    window.__pointer = await import("/src/editor/pointer.js");
    window.__infer = await import("/src/editor/dimension-inference.js");
    window.__hit = await import("/src/editor/hit-testing.js");
  });

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

  return page.evaluate((p) => {
    const event = new MouseEvent("pointermove", {
      bubbles: true,
      cancelable: true,
      clientX: p.x,
      clientY: p.y,
    });

    const resolution = window.__pointer.resolvePointerEvent(event);

    const point =
      resolution.effectiveConstructionPoint ||
      resolution.snappedPoint ||
      resolution.rawPointerPoint;

    const reference = point
      ? window.__infer.dimensionReferenceAtClick(resolution, point, false)
      : null;

    const raw = window.__hit.objectAtPoint(resolution.rawPointerPoint || point);

    return {
      effectiveConstructionPoint: resolution.effectiveConstructionPoint,
      snappedPoint: resolution.snappedPoint,
      rawPointerPoint: resolution.rawPointerPoint,
      snapCandidate: resolution.snapCandidate
        ? {
            type: resolution.snapCandidate.type,
            objectId: resolution.snapCandidate.objectId,
          }
        : null,
      objectAtRawPoint: raw ? { type: raw.type } : null,
      reference: reference
        ? {
            kind: reference.kind,
            anchor: reference.anchor,
            endAnchor: reference.endAnchor,
          }
        : null,
    };
  }, point);
}

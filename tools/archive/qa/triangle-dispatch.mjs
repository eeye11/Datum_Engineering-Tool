/*
 * Drive the REAL click handler with a synthetic event at the projected point,
 * and report what the dimension tool did - so the failure is visible rather
 * than inferred.
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
    window.__click = await import("/src/editor/canvas-click.js");
    window.__pointer = await import("/src/editor/pointer.js");
    window.__infer = await import("/src/editor/dimension-inference.js");
  });

  const tab = page
    .locator("button", { hasText: "Engineering Drawing" })
    .first();
  if (await tab.count()) await tab.click();
  await page.waitForTimeout(900);

  await page.locator('button[data-category="ANNOTATE"]').click();
  await page.waitForTimeout(250);
  await page
    .locator('#drawingToolList [data-tool-id="smart-dimension"]')
    .first()
    .click();
  await page.waitForTimeout(250);

  return page.evaluate(() => {
    const st = window.enggDrawing.state;
    const D = window.enggDrawingState;

    st.objects.length = 0;

    const triangle = D.geometryFactories.triangle([
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 0, y: 30 },
    ]);

    D.addObject(st, triangle);

    const canvas = document.querySelector(".drawing-canvas");
    const bounds = canvas.getBoundingClientRect();

    const p = D.engineeringToScreen({ x: 20, y: 0 }, bounds, st);

    /*
     * A synthetic event with real client coordinates, at the point we know is
     * on the side. `resolvePointerEvent` reads clientX/clientY, so these must
     * be the SCREEN coordinates, not world ones.
     */
    const event = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      clientX: p.x,
      clientY: p.y,
    });

    const resolution = window.__pointer.resolvePointerEvent(event);

    /* What the inference makes of the resolved point. */
    const reference = window.__infer.dimensionReferenceAtClick(
      resolution,
      resolution.effectiveConstructionPoint || resolution.rawPointerPoint,
      false,
    );

    let threw = null;

    try {
      window.__click.handleCanvasClick(event);
    } catch (error) {
      threw = String(error && error.stack ? error.stack.slice(0, 400) : error);
    }

    const i = st.interaction;

    return {
      resolvedPoint: resolution.effectiveConstructionPoint || null,
      snappedPoint: resolution.snappedPoint || null,
      snapType: resolution.snapCandidate ? resolution.snapCandidate.type : null,
      reference: reference
        ? { kind: reference.kind, anchor: reference.anchor }
        : null,
      threw,
      stage: i.dimensionStage,
      choice: i.dimensionChoice,
      activeTool: st.activeTool,
    };
  });
}

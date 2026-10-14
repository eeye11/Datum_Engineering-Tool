/*
 * ========================================================
 * VARIABLE DIMENSION, BY REAL CLICKS
 * ========================================================
 *
 * The sibling relationship, checked on the running page: two non-parallel lines
 * selected with Variable Dimension must infer an ANGLE, be placed, and then open
 * the SHARED value popup asking for the student's own value - and the feature
 * that results must state exactly what they typed.
 */
export default async function run(page) {
  const errs = [];

  page.on("pageerror", (e) =>
    errs.push("PAGEERROR: " + e.message.slice(0, 220)),
  );
  page.on("console", (m) => {
    if (m.type() === "error") errs.push("CONSOLE: " + m.text().slice(0, 180));
  });

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

  const out = { errs };

  /*
   * Two lines meeting at the origin at a real angle, and the SCREEN point on
   * the middle of each - computed with the application's own projector.
   */
  const aim = await page.evaluate(() => {
    const st = window.enggDrawing.state;
    const D = window.enggDrawingState;

    st.objects.length = 0;
    st.selection.selectedObjectIds = [];

    const A = D.geometryFactories.line({ x: 0, y: 0 }, { x: 120, y: 0 });
    const B = D.geometryFactories.line({ x: 0, y: 0 }, { x: 90, y: 90 });

    D.addObject(st, A);
    D.addObject(st, B);

    const bounds = document
      .querySelector(".drawing-canvas")
      .getBoundingClientRect();

    const toScreen = (p) => {
      const local = D.engineeringToScreen(p, bounds, st);
      return { x: bounds.left + local.x, y: bounds.top + local.y };
    };

    return {
      onA: toScreen({ x: 60, y: 0 }),
      onB: toScreen({ x: 45, y: 45 }),
    };
  });

  out.aim = aim;

  /* The Variable Dimension tool. */
  await page.locator('button[data-category="ANNOTATE"]').click();
  await page.waitForTimeout(250);
  await page
    .locator('#drawingToolList [data-tool-id="variable-dimension"]')
    .first()
    .click();
  await page.waitForTimeout(250);

  out.tool = await page.evaluate(() => window.enggDrawing.state.activeTool);

  /* Click the first line, then the second. */
  await page.mouse.click(aim.onA.x, aim.onA.y);
  await page.waitForTimeout(300);

  await page.mouse.click(aim.onB.x, aim.onB.y);
  await page.waitForTimeout(350);

  out.afterSecond = await page.evaluate(() => {
    const i = window.enggDrawing.state.interaction;

    return {
      stage: i.dimensionStage,
      choice: i.dimensionChoice,
    };
  });

  /* Place it, which should OPEN THE PROMPT rather than commit. */
  await page.mouse.click(aim.onA.x + 30, aim.onA.y - 45);
  await page.waitForTimeout(400);

  out.prompt = await page.evaluate(() => {
    const popup = document.querySelector(".drawing-creation-dimension");

    return popup
      ? {
          opened: true,
          title: popup.querySelector(".drawing-creation-dimension-title")
            ?.textContent,
          label: popup.querySelector("[data-load-label]")?.textContent,
          hasUnitControl: Boolean(popup.querySelector("[data-load-unit]")),
        }
      : { opened: false };
  });

  out.variablesBefore = await page.evaluate(
    () =>
      window.enggDrawing.state.objects.filter(
        (o) => o.type === "variable-dimension",
      ).length,
  );

  /* Type a symbol and confirm with Enter. */
  const popupInput = page.locator("[data-load-input]");

  if (await popupInput.count()) {
    await popupInput.first().fill("θ");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(400);
  }

  out.variable = await page.evaluate(() => {
    const st = window.enggDrawing.state;

    const object = st.objects.find((o) => o.type === "variable-dimension");

    if (!object) {
      return null;
    }

    return {
      symbol: object.symbol,
      dimensionType: object.dimensionType,
      refCount: (object.sourceRefs || []).length,
      filledRefs: (object.sourceRefs || []).every((r) => Boolean(r.featureId)),
    };
  });

  return out;
}

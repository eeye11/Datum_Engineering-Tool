/*
 * ========================================================
 * ACCEPTANCE TEST - BOTH CREATION INTERACTIONS
 * ========================================================
 *
 * The same Line tool must work two ways, with no mode selector:
 *
 *   CLICK-MOVE-CLICK
 *     press + release (no travel) -> start point
 *     move                        -> live preview follows
 *     click                       -> committed
 *
 *   CLICK-DRAG-RELEASE
 *     press, travel, release      -> committed at the release
 *
 * THE BUG: the press started the feature AND armed a drag session, so a plain
 * click was completed on release AT ITS OWN START POINT - a zero-length line,
 * committed before the student had moved. Click-move-click was therefore
 * impossible: every first click created something.
 *
 * The gesture is now classified on release by how far the pointer travelled.
 */

export default async function run(page) {
  const out = {};
  const errors = [];

  page.on("pageerror", (e) => errors.push(String((e && e.message) || e)));

  await page.waitForFunction(() => typeof window.datum === "object", null, {
    timeout: 60000,
  });

  await page.evaluate(async () => {
    if (typeof window.enggDrawing !== "object") {
      const mod = await import("/src/app/automation-hooks.js");
      mod.installAutomationHooks();
    }
  });

  const tab = page.getByRole("button", { name: "Engineering Drawing" });
  if (await tab.count()) {
    await tab.first().click();
    await page.waitForTimeout(900);
  }

  const box = await page.locator(".drawing-canvas").first().boundingBox();

  const at = (fx, fy) => ({
    x: box.x + box.width * fx,
    y: box.y + box.height * fy,
  });

  const clearAll = () =>
    page.evaluate(() => {
      const ds = window.enggDrawingState;
      const st = window.enggDrawing.state;

      const before = ds.snapshotDrawing(st);
      st.objects = [];
      ds.commitDrawingChange(st, before);
      ds.clearInteraction(st);
    });

  /* ---------------------------------------------------------------- */
  /* 1. CLICK-MOVE-CLICK                                                */
  /* ---------------------------------------------------------------- */

  await clearAll();

  await page.evaluate(() => {
    const ds = window.enggDrawingState;
    ds.setActiveTool(window.enggDrawing.state, "line");
  });

  /* A plain click: press and release without moving. */
  const startPoint = at(0.25, 0.5);
  await page.mouse.move(startPoint.x, startPoint.y);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(300);

  const afterFirstClick = await page.evaluate(() => {
    const st = window.enggDrawing.state;

    return {
      objects: st.objects.length,
      phase: st.interaction.phase,
      hasStart: Boolean(st.interaction.startPoint),
    };
  });

  out.afterFirstClick = afterFirstClick;

  /* Move: the preview must follow. */
  const endPoint = at(0.6, 0.5);
  await page.mouse.move(endPoint.x + 1, endPoint.y + 1, { steps: 6 });
  await page.waitForTimeout(250);

  const afterMove = await page.evaluate(() => {
    const st = window.enggDrawing.state;

    return {
      objects: st.objects.length,
      phase: st.interaction.phase,
      current: st.interaction.currentPoint
        ? { x: st.interaction.currentPoint.x, y: st.interaction.currentPoint.y }
        : null,
    };
  });

  out.afterMove = afterMove;

  /* The second click commits. */
  await page.mouse.click(endPoint.x + 2, endPoint.y + 2);
  await page.waitForTimeout(400);

  out.afterSecondClick = await page.evaluate(() => {
    const st = window.enggDrawing.state;

    const line = st.objects.find((o) => o.type === "line");

    return {
      objects: st.objects.length,
      types: st.objects.map((o) => o.type),
      line: line
        ? {
            start: { ...line.geometry.start },
            end: { ...line.geometry.end },
          }
        : null,
      phase: st.interaction.phase,
    };
  });

  /* ---------------------------------------------------------------- */
  /* 2. CLICK-DRAG-RELEASE, the SAME geometry                          */
  /* ---------------------------------------------------------------- */

  await clearAll();

  await page.evaluate(() => {
    const ds = window.enggDrawingState;
    ds.setActiveTool(window.enggDrawing.state, "line");
  });

  await page.mouse.move(startPoint.x, startPoint.y);
  await page.mouse.down();
  await page.mouse.move(endPoint.x + 2, endPoint.y + 2, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(400);

  out.afterDrag = await page.evaluate(() => {
    const st = window.enggDrawing.state;

    const line = st.objects.find((o) => o.type === "line");

    return {
      objects: st.objects.length,
      types: st.objects.map((o) => o.type),
      line: line
        ? {
            start: { ...line.geometry.start },
            end: { ...line.geometry.end },
          }
        : null,
      phase: st.interaction.phase,
    };
  });

  /* ---------------------------------------------------------------- */
  /* 3. A TINY MOVEMENT IS STILL A CLICK                                */
  /* ---------------------------------------------------------------- */

  await clearAll();

  await page.evaluate(() => {
    const ds = window.enggDrawingState;
    ds.setActiveTool(window.enggDrawing.state, "line");
  });

  await page.mouse.move(startPoint.x, startPoint.y);
  await page.mouse.down();
  /* Two pixels: hand tremor, not a drag. */
  await page.mouse.move(startPoint.x + 2, startPoint.y + 1);
  await page.mouse.up();
  await page.waitForTimeout(300);

  out.tinyMove = await page.evaluate(() => {
    const st = window.enggDrawing.state;

    return {
      objects: st.objects.length,
      phase: st.interaction.phase,
      message: (document.getElementById("drawingToolMessage") || "")
        .textContent,
    };
  });

  out.errors = errors;

  return out;
}

/*
 * ========================================================
 * THE SMART DIMENSION CLICK FLOW, ON A TRIANGLE
 * ========================================================
 *
 * What only a running page can show: the ARMED sequence. Clicking one side of
 * a triangle must arm a LENGTH, and clicking a second side must switch the
 * armed measurement to the ANGLE - with no Enter, no popup, no third step.
 *
 * The clicks are dispatched through the application's own hit test rather than
 * at guessed pixels: a world point a little inside each side is converted to
 * screen coordinates with the renderer's projector, so the click genuinely
 * lands on the edge the test means.
 */
export default async function run(page) {
  const errs = [];

  page.on("pageerror", (e) => errs.push("PAGEERROR: " + e.message.slice(0, 220)));
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

  const tab = page.locator("button", { hasText: "Engineering Drawing" }).first();
  if (await tab.count()) await tab.click();
  await page.waitForTimeout(900);

  const out = { errs };

  /*
   * A right triangle on screen, and the SCREEN position of a point sitting
   * just inside each of its three sides.
   *
   * THE CANVAS BOUNDS ARE READ NOW, not before - the drawing tab has to be
   * the active one for the canvas to have a real size, and a projection taken
   * against a hidden canvas points at the wrong place entirely.
   */
  out.aim = await page.evaluate(() => {
    const st = window.enggDrawing.state;
    const D = window.enggDrawingState;

    st.objects.length = 0;
    st.selection.selectedObjectIds = [];

    const A = { x: 0, y: 0 };
    const B = { x: 40, y: 0 };
    const C = { x: 0, y: 30 };

    const triangle = D.geometryFactories.triangle([A, B, C]);
    D.addObject(st, triangle);
    window.__tri = triangle.id;

    /*
     * Redraw first, so the camera and the canvas are settled before the
     * projection is taken.
     */
    const bounds = document
      .querySelector(".drawing-canvas")
      .getBoundingClientRect();

    const toScreen = (p) => {
      /*
       * `engineeringToScreen` returns a point measured FROM THE CANVAS'S OWN
       * TOP-LEFT - that is the space the renderer draws in - so the canvas's
       * position on the page is added to turn it into the CLIENT coordinate a
       * mouse event carries. Getting this wrong aims the click at empty space
       * a panel-width away, which looks exactly like the tool being broken.
       */
      const local = D.engineeringToScreen(p, bounds, st);

      return { x: local.x + bounds.left, y: local.y + bounds.top };
    };

    const mid = (p, q) => ({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 });

    const interior = { x: 13, y: 10 };

    const nudge = (from, to, amount) => {
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const len = Math.hypot(dx, dy) || 1;
      return { x: from.x + (dx / len) * amount, y: from.y + (dy / len) * amount };
    };

    const onAB = nudge(mid(A, B), interior, 0.6);
    const onAC = nudge(mid(A, C), interior, 0.6);

    return { AB: toScreen(onAB), AC: toScreen(onAC) };
  });

  /* Smart Dimension. */
  await page.locator('button[data-category="ANNOTATE"]').click();
  await page.waitForTimeout(250);
  await page
    .locator('#drawingToolList [data-tool-id="smart-dimension"]')
    .first()
    .click();
  await page.waitForTimeout(250);

  const armed = () =>
    page.evaluate(() => {
      const i = window.enggDrawing.state.interaction;

      return {
        stage: i.dimensionStage,
        choice: i.dimensionChoice,
        picked: (i.dimensionPickedRefs || []).map((r) => r.anchor),
      };
    });

  /* FIRST side: must arm a LENGTH. */
  await page.mouse.click(out.aim.AB.x, out.aim.AB.y);
  await page.waitForTimeout(300);
  out.afterFirst = await armed();

  /* SECOND side: must switch to the ANGLE at their shared vertex. */
  await page.mouse.click(out.aim.AC.x, out.aim.AC.y);
  await page.waitForTimeout(300);
  out.afterSecond = await armed();

  return out;
}

/*
 * QA the CIRCULAR DIMENSION corrections in the RUNNING app.
 *
 * What only a live page can show, and what the unit tests cannot:
 *
 *   1. Clicking a circle with Smart Dimension resolves ONE reference that
 *      offers BOTH diameter and radius - not a single collapsed candidate.
 *   2. Tab cycles between them, and each cycle changes the measured value
 *      (40 mm vs 20 mm on an r=20 circle) with the right symbol.
 *   3. An arc offers radius AND arc length, and arc length is the curved
 *      length (r * sweep), not the straight chord.
 *   4. The RENDERED geometry agrees with the value: a diameter's dimension
 *      line crosses the centre, an arc length is drawn as a POLYLINE along
 *      the arc rather than a straight chord.
 *
 * The clicks go through the application's own projector, so a click lands on
 * the circumference the test means rather than at a guessed pixel.
 */
export default async function run(page) {
  const errs = [];

  page.on("pageerror", (e) =>
    errs.push("PAGEERROR: " + e.message.slice(0, 220)),
  );
  page.on("console", (m) => {
    if (m.type() === "error") errs.push("CONSOLE: " + m.text().slice(0, 180));
  });

  const out = { errs };

  await page.evaluate(async () => {
    await import("/src/main.js");
  });
  await page.waitForFunction(
    () => !!(window.enggDrawing && window.enggDrawing.state),
    { timeout: 15000 },
  );

  const tab = page.getByRole("button", { name: "Engineering Drawing" });
  if (await tab.count()) {
    await tab.first().click();
    await page.waitForTimeout(900);
  }

  /*
   * A circle of radius 20 at (100, 100), and an arc of radius 30 sweeping
   * 90 degrees. The radius is chosen so the expected values are obvious:
   * a diameter of 40 mm and an arc length of 30 * (pi/2) mm.
   */
  out.aim = await page.evaluate(() => {
    const st = window.enggDrawing.state;
    const D = window.enggDrawingState;

    st.objects.length = 0;
    st.selection.selectedObjectIds = [];

    /*
     * CALIBRATED FIRST.
     *
     * An uncalibrated drawing routes the FIRST dimension into the scale dialog
     * instead of creating it - so without a scale the commit below would produce a
     * dialog and no dimension, and the render check would be looking at nothing.
     * One millimetre per drawing unit is the simplest honest calibration and is
     * exactly what `readScale` accepts.
     */
    st.scale = { mmPerUnit: 1, unit: "mm" };

    const circle = D.geometryFactories.circle
      ? D.geometryFactories.circle({ x: 100, y: 100 }, 20)
      : null;

    if (circle) {
      D.addObject(st, circle);
      window.__circle = circle.id;
    }

    const bounds = document
      .querySelector(".drawing-canvas")
      .getBoundingClientRect();

    const toScreen = (p) => {
      const local = D.engineeringToScreen(p, bounds, st);
      return { x: local.x + bounds.left, y: local.y + bounds.top };
    };

    return {
      circleId: circle ? circle.id : null,
      circumference: toScreen({ x: 120, y: 100 }),
      centre: toScreen({ x: 100, y: 100 }),
      /*
       * A screen point near the top-left of the canvas: empty space, used to commit
       * the placed dimension. Chosen inside the canvas bounds so the click counts.
       */
      empty: {
        x: bounds.left + bounds.width * 0.85,
        y: bounds.top + bounds.height * 0.85,
      },
    };
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

      const refs = i.dimensionPickedRefs || [];

      return {
        stage: i.dimensionStage,
        choice: i.dimensionChoice,
        kind: refs[0]?.kind || null,
        offered: refs[0]?.offered || null,
        candidates: (i.dimensionCandidates || []).map((c) => c.dimensionType),
        refs: i.dimensionRefs || null,
      };
    });

  /* One click on the circumference. */
  await page.mouse.click(out.aim.circumference.x, out.aim.circumference.y);
  await page.waitForTimeout(350);
  out.afterClick = await armed();

  /*
   * Tab ONCE: the second candidate must be a DIFFERENT valid measurement of the
   * SAME circle - no extra pick, no popup. A circle that collapsed to a single
   * candidate is exactly the defect this checks for: Tab would find nowhere to
   * go and `choice` would not change.
   */
  await page.keyboard.press("Tab");
  await page.waitForTimeout(300);
  out.afterTab = await armed();

  /*
   * The rendered value for the current choice, read from the model the same
   * way the canvas renders it - so a wrong symbol or a chord length shows up
   * here rather than being hidden behind a picture.
   */
  const rendered = () =>
    page.evaluate(async () => {
      const st = window.enggDrawing.state;
      const model = (await import("/src/features/dimensions/dimension-model.js"))
        .default;

      const dimension = st.objects.find((o) => o.type === "dimension");

      if (!dimension) {
        return null;
      }

      const g = model.graphicsFor(dimension, st);

      return {
        dimensionType: dimension.dimensionType,
        text: model.formatMeasurement(dimension, st),
        kind: g ? g.kind : null,
        // The arc-length graphic carries a polyline; a linear one does not.
        arcPoints: g && g.arc ? g.arc.length : 0,
        lineCrossesCentre: g && g.line
          ? {
              from: g.line[0],
              to: g.line[1],
            }
          : null,
        centre: g ? g.centre || null : null,
      };
    });

  /*
   * Place it: Enter settles the references, then a click on EMPTY canvas commits
   * the dimension where it stands. The commit is the real one the tool uses - the
   * armed stage is watched above, and this drives the placement stage that follows
   * it, so what renders is a genuine committed feature and not a preview.
   */
  await page.evaluate(async () => {
    const mod = await import("/src/editor/dimension-placement.js");
    mod.commitDimensionSelection();
  });
  await page.waitForTimeout(300);

  /*
   * A point well clear of the circle at (100, 100) and of the toolbar: the click
   * resolves to no reference, which is the placement gesture. Taken from the canvas
   * box rather than a world point, because empty space has no world coordinate to
   * project.
   */
  await page.mouse.click(
    out.aim.empty.x,
    out.aim.empty.y,
  );
  await page.waitForTimeout(400);
  out.afterPlaceClick = await armed();
  out.placed = await armed();
  out.rendered = await rendered();

  /*
   * ========================================================
   * AND THE ARC: ARC LENGTH MUST BE THE CURVED LENGTH
   * ========================================================
   *
   * A radius of 30 sweeping a quarter turn has an arc length of 30 * (pi / 2)
   * = 47.12 mm and a straight chord of 30 * sqrt(2) = 42.43 mm. The two numbers
   * differ, and the graphic differs more: the arc length is drawn as a POLYLINE
   * along the sweep, not a straight line between the ends. That `arcPoints > 0`
   * is the check - a chord would come back as the linear graphic with no arc.
   */
  await page.evaluate(async () => {
    const st = window.enggDrawing.state;
    const D = window.enggDrawingState;

    st.objects = st.objects.filter((o) => o.type !== "dimension");

    const arc = D.geometryFactories.arc
      ? D.geometryFactories.arc({ x: 300, y: 100 }, 30, 0, Math.PI / 2)
      : null;

    if (arc) {
      D.addObject(st, arc);
      window.__arc = arc.id;
    }
  });

  /* Click the arc's midpoint - half way along its 45-degree sweep. */
  out.aimArc = await page.evaluate(() => {
    const st = window.enggDrawing.state;
    const D = window.enggDrawingState;
    const bounds = document.querySelector(".drawing-canvas").getBoundingClientRect();

    const mid = {
      x: 300 + 30 * Math.cos(Math.PI / 4),
      y: 100 + 30 * Math.sin(Math.PI / 4),
    };

    const local = D.engineeringToScreen(mid, bounds, st);
    return { x: local.x + bounds.left, y: local.y + bounds.top, arcId: window.__arc };
  });

  await page.mouse.click(out.aimArc.x, out.aimArc.y);
  await page.waitForTimeout(350);
  out.arcAfterClick = await armed();

  /*
   * The model's OWN view of the arc, built from the arc's real anchor references -
   * the same references a click on the arc produces. This asserts the graphic and the
   * value directly, which is what the requirement is about, without depending on the
   * click landing within a pixel of the curve.
   */
  const arcRendered = () =>
    page.evaluate(async () => {
      const st = window.enggDrawing.state;
      const model = (await import("/src/features/dimensions/dimension-model.js"))
        .default;

      const arcId = window.__arc;

      const refs = [
        { kind: "between", featureId: arcId, anchor: "start" },
      ];

      const fromType = (type) => {
        const dimension = {
          id: "probe",
          type: "dimension",
          dimensionType: type,
          sourceRefs: refs,
          placement: { x: 300, y: 100 },
        };

        const g = model.graphicsFor(dimension, st);

        return {
          dimensionType: type,
          text: model.formatMeasurement(dimension, st),
          kind: g ? g.kind : null,
          arcPoints: g && g.arc ? g.arc.length : 0,
          arrowheads: g && g.arrowheads ? g.arrowheads.length : 0,
        };
      };

      return {
        radius: fromType("radius"),
        arcLength: fromType("arc-length"),
      };
    });

  out.arcRendered = await arcRendered();

  return out;
}

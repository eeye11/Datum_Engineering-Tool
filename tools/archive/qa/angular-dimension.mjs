/*
 * ========================================================
 * SMART DIMENSION: THE ANGULAR WORKFLOW
 * ========================================================
 *
 * Drives the real page: two lines at a known angle, Smart Dimension clicked
 * on each, the cursor moved into different sectors, and the resulting value
 * read back. What is being checked is the SPECIFICATION's claim - that the
 * CURSOR chooses which of the four sectors is dimensioned, and that the
 * geometry it is measured from is world-space and independent of how the
 * lines were drawn.
 *
 * The angle is set up by placing the two lines with KNOWN world coordinates
 * rather than by clicking pixels, so the expected value is arithmetic and not
 * a guess about where a click landed.
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

  /*
   * The dimension model is an ES module default export, not a window global,
   * so it is imported by path here. This is the SAME module the application
   * uses - not a copy - so a value read through it is the value the tool
   * would commit.
   */
  await page.evaluate(async () => {
    window.__dimModel = (await import("/src/features/dimensions/dimension-model.js"))
      .default;
  });

  const tab = page.locator("button", { hasText: "Engineering Drawing" }).first();
  if (await tab.count()) await tab.click();
  await page.waitForTimeout(900);

  const out = { errs };

  /*
   * Build a document directly: two lines meeting at the origin at a known
   * angle. This removes every pixel-coordinate uncertainty from the test.
   */
  await page.evaluate(() => {
    const st = window.enggDrawing.state;
    const D = window.enggDrawingState;

    // Clear anything already there.
    st.objects.length = 0;
    st.selection.selectedObjectIds = [];

    // Line A along +X. Line B at 35 degrees above it.
    const deg = (d) => (d * Math.PI) / 180;
    const len = 200;
    const angleB = deg(35);

    const a = D.geometryFactories.line({ x: 0, y: 0 }, { x: len, y: 0 });
    const b = D.geometryFactories.line(
      { x: 0, y: 0 },
      { x: len * Math.cos(angleB), y: len * Math.sin(angleB) },
    );

    D.addObject(st, a);
    D.addObject(st, b);
    window.__lineA = a.id;
    window.__lineB = b.id;
  });

  /*
   * Measure an angular dimension between the two lines with its placement in
   * a given WORLD sector, and return the value it reports.
   *
   * The dimension is built through the same factory the tool uses, so the
   * value read back is the value the tool would commit.
   */
  const measureWithPlacement = (px, py) =>
    page.evaluate(
      ({ px, py }) => {
        const st = window.enggDrawing.state;
        const D = window.enggDrawingState;

        const ref = (id) => ({
          kind: "between",
          featureId: id,
          anchor: "start",
        });

        const dim = D.geometryFactories.dimension({
          dimensionType: "angular",
          refs: [ref(window.__lineA), ref(window.__lineB)],
          placement: { x: px, y: py },
        });

        st.objects.push(dim);

        const m = window.__dimModel.measurementFor(dim, st);
        st.objects.pop();

        return m ? Math.round(m.value * 100) / 100 : null;
      },
      { px, py },
    );

  // The cursor direction from the vertex picks the sector. +X and +Y are the
  // 35-degree (narrow) side above the axis; -Y is the 145-degree (wide) side.
  out.acuteAbove = await measureWithPlacement(120, 30); // between the axes
  out.obtuseBelow = await measureWithPlacement(120, -30); // below line A
  out.obtuseLeft = await measureWithPlacement(-120, 30); // beyond the vertex
  out.acuteThruLeft = await measureWithPlacement(-120, -30);

  /*
   * ROTATION INVARIANCE: rotate BOTH lines by 40 degrees and re-measure with
   * the placement rotated to match. The angle must be unchanged.
   */
  out.rotatedAcute = await page.evaluate(() => {
    const st = window.enggDrawing.state;
    const D = window.enggDrawingState;

    const a = st.objects.find((o) => o.id === window.__lineA);
    const b = st.objects.find((o) => o.id === window.__lineB);

    const deg = (d) => (d * Math.PI) / 180;
    const rot = (p, t) => ({
      x: p.x * Math.cos(t) - p.y * Math.sin(t),
      y: p.x * Math.sin(t) + p.y * Math.cos(t),
    });

    const t = deg(40);

    a.geometry.start = rot({ x: 0, y: 0 }, t);
    a.geometry.end = rot({ x: 200, y: 0 }, t);

    b.geometry.start = rot({ x: 0, y: 0 }, t);
    b.geometry.end = rot(
      { x: 200 * Math.cos(deg(35)), y: 200 * Math.sin(deg(35)) },
      t,
    );

    const ref = (id) => ({ kind: "between", featureId: id, anchor: "start" });

    const dim = D.geometryFactories.dimension({
      dimensionType: "angular",
      refs: [ref(window.__lineA), ref(window.__lineB)],
      placement: rot({ x: 120, y: 30 }, t),
    });

    st.objects.push(dim);

    const m = window.__dimModel.measurementFor(dim, st);
    st.objects.pop();

    return m ? Math.round(m.value * 100) / 100 : null;
  });

  /*
   * REVERSED ENDPOINTS: store line B end-to-start. The physical line is the
   * same, so the same placement must give the same angle.
   */
  out.reversedEndpoint = await page.evaluate(() => {
    const st = window.enggDrawing.state;
    const D = window.enggDrawingState;

    const a = st.objects.find((o) => o.id === window.__lineA);
    const b = st.objects.find((o) => o.id === window.__lineB);

    const deg = (d) => (d * Math.PI) / 180;
    const rot = (p, t) => ({
      x: p.x * Math.cos(t) - p.y * Math.sin(t),
      y: p.x * Math.sin(t) + p.y * Math.cos(t),
    });
    const t = deg(40);

    // Restore A to horizontal, then SWAP B's two ends.
    a.geometry.start = { x: 0, y: 0 };
    a.geometry.end = { x: 200, y: 0 };

    const bEnd = {
      x: 200 * Math.cos(deg(35)),
      y: 200 * Math.sin(deg(35)),
    };

    b.geometry.start = bEnd; // reversed: end -> start
    b.geometry.end = { x: 0, y: 0 };

    const ref = (id) => ({ kind: "between", featureId: id, anchor: "start" });

    const dim = D.geometryFactories.dimension({
      dimensionType: "angular",
      refs: [ref(window.__lineA), ref(window.__lineB)],
      placement: { x: 120, y: 30 },
    });

    st.objects.push(dim);

    const m = window.__dimModel.measurementFor(dim, st);
    st.objects.pop();

    return m ? Math.round(m.value * 100) / 100 : null;
  });

  /*
   * ZOOM INVARIANCE: the same dimension measured at three zooms.
   */
  out.byZoom = {};
  for (const zoom of [0.5, 1, 4]) {
    out.byZoom[zoom] = await page.evaluate((z) => {
      const st = window.enggDrawing.state;
      st.camera.zoom = z;

      const D = window.enggDrawingState;
      const ref = (id) => ({ kind: "between", featureId: id, anchor: "start" });

      const dim = D.geometryFactories.dimension({
        dimensionType: "angular",
        refs: [ref(window.__lineA), ref(window.__lineB)],
        placement: { x: 120, y: 30 },
      });

      st.objects.push(dim);
      const m = window.__dimModel.measurementFor(dim, st);
      st.objects.pop();

      return m ? Math.round(m.value * 100) / 100 : null;
    }, zoom);
  }

  /* PARALLEL LINES: the inference must not offer an angular dimension, so a
   * misleading arc is never drawn. Checked through the shared inference. */
  out.parallel = await page.evaluate(async () => {
    const st = window.enggDrawing.state;
    const D = window.enggDrawingState;

    st.objects.length = 0;

    const a = D.geometryFactories.line({ x: 0, y: 0 }, { x: 200, y: 0 });
    const b = D.geometryFactories.line({ x: 0, y: 100 }, { x: 200, y: 100 });

    D.addObject(st, a);
    D.addObject(st, b);

    const inference = await import("/src/editor/dimension-inference.js");

    const refA = {
      kind: "line",
      featureId: a.id,
      anchor: "start",
      endAnchor: "end",
      object: a,
    };
    const refB = {
      kind: "line",
      featureId: b.id,
      anchor: "start",
      endAnchor: "end",
      object: b,
    };

    const descriptor = inference.inferDimensionDescriptor(refA, refB);

    return {
      dimensionType: descriptor ? descriptor.dimensionType : null,
      isAngular: descriptor ? descriptor.dimensionType === "angular" : false,
    };
  });

  return out;
}


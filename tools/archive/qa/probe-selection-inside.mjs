/*
 * ========================================================
 * ACCEPTANCE TEST - SELECTION INSIDE A CLOSED SHAPE
 * ========================================================
 *
 * Datum has no Fill tool, so a Triangle (and a Rectangle, and a Polygon) is a
 * collection of EDGES, not a filled region. The bug was that the triangle's
 * hit test also accepted points INSIDE it, so it behaved like an opaque shape
 * and swallowed every click within its perimeter - an inner line could never
 * be selected through it.
 *
 * This builds a triangle with a line inside it and checks:
 *
 *   - clicking the INNER LINE selects the line, not the triangle
 *   - clicking a triangle EDGE still selects the triangle
 *   - a selection rectangle over the inner line selects the line
 */

export default async function run(page) {
  const out = {};

  await page.waitForFunction(() => typeof window.datum === "object", null, {
    timeout: 20000,
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

  /* A large triangle with a short line inside it. */
  const built = await page.evaluate(() => {
    const ds = window.enggDrawingState;
    const st = window.enggDrawing.state;

    const before = ds.snapshotDrawing(st);
    st.objects = [];

    const triangle = {
      id: "tri_1",
      type: "triangle",
      name: "Triangle 1",
      geometry: {
        points: [
          { x: 0, y: 0 },
          { x: 400, y: 0 },
          { x: 200, y: 300 },
        ],
      },
      style: { stroke: "#000000", lineWidth: 1, fill: "none" },
    };

    const inner = {
      id: "line_in",
      type: "line",
      name: "Line 1",
      geometry: {
        start: { x: 160, y: 60 },
        end: { x: 240, y: 60 },
      },
      style: { stroke: "#000000", lineWidth: 1 },
    };

    st.objects.push(triangle, inner);

    ds.commitDrawingChange(st, before);

    return { ids: st.objects.map((o) => o.id) };
  });

  out.built = built;

  /* Fit, so the shapes are known to be on screen before clicking. */
  await page.evaluate(async () => {
    const fit = document.querySelector('[data-global-tool="fit"]');
    if (fit) {
      fit.click();
      await new Promise((r) => setTimeout(r, 400));
    }
  });

  /*
   * Ask the hit test directly with a point INSIDE the triangle and ON the line.
   * Driving the real pointer would depend on the fitted camera, so the model
   * question is asked of the same function the click uses.
   */
  out.hitTest = await page.evaluate(async () => {
    const mod = await import("/src/editor/hit-testing.js");
    const ds = window.enggDrawingState;
    const st = window.enggDrawing.state;

    const onLine = { x: 200, y: 60 };
    const inTriangleOnly = { x: 60, y: 40 };
    const onTriangleEdge = { x: 200, y: 0 };

    const picked = (point) => {
      const object = mod.objectAtPoint ? mod.objectAtPoint(point, st) : null;

      return object ? object.id : null;
    };

    /* Some builds route through the state's own helper. */
    const picker =
      mod.objectAtPoint ||
      (window.enggDrawingState.objectAtPoint
        ? window.enggDrawingState.objectAtPoint
        : null);

    const pick = (point) => {
      if (picker) {
        const found = picker(point, st, undefined);
        return found ? found.id : null;
      }
      return null;
    };

    return {
      hasObjectAtPoint: typeof mod.objectAtPoint === "function",
      onLine: pick(onLine),
      inTriangleOnly: pick(inTriangleOnly),
      onTriangleEdge: pick(onTriangleEdge),
      unused: typeof picked,
      scale: ds.BASE_PIXELS_PER_UNIT,
    };
  });

  /*
   * And the model-level selection: selecting by point must reach the line.
   */
  out.selectByPoint = await page.evaluate(async () => {
    const mod = await import("/src/editor/hit-testing.js");

    if (typeof mod.objectAtPoint !== "function") {
      return { error: "objectAtPoint is not exported" };
    }

    const st = window.enggDrawing.state;

    const onLine = mod.objectAtPoint({ x: 200, y: 60 }, st);
    const interior = mod.objectAtPoint({ x: 60, y: 40 }, st);
    const edge = mod.objectAtPoint({ x: 200, y: 0 }, st);

    return {
      onLine: onLine ? onLine.id : null,
      interior: interior ? interior.id : null,
      edge: edge ? edge.id : null,
    };
  });

  /* A selection rectangle over the inner line must find the line. */
  out.boxSelect = await page.evaluate(async () => {
    const mod = await import("/src/editor/box-selection.js");
    const st = window.enggDrawing.state;

    /* A box containing only the inner line (well inside the triangle). */
    const box = { minX: 150, minY: 40, maxX: 250, maxY: 80 };

    const hits = st.objects
      .filter((o) => mod.objectIntersectsSelection(o, box))
      .map((o) => o.id);

    /* A box around a triangle edge but no inner line. */
    const edgeBox = { minX: 190, minY: -10, maxX: 210, maxY: 10 };

    const edgeHits = st.objects
      .filter((o) => mod.objectIntersectsSelection(o, edgeBox))
      .map((o) => o.id);

    return { hits, edgeHits };
  });

  return out;
}

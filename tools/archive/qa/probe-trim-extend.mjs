/*
 * ========================================================
 * ACCEPTANCE TEST - TRIM AND EXTEND
 * ========================================================
 *
 * A line crossing a boundary, and a line that stops short of one:
 *
 *   TRIM    the clicked end is cut back to the boundary
 *   EXTEND  the clicked end is grown out to the boundary
 *
 * Both must be one Undoable action, must leave the OTHER geometry alone, and
 * must leave a dimension measuring the line still resolving afterwards.
 */

export default async function run(page) {
  const out = { steps: [] };
  const log = (name, value) => out.steps.push({ name, value });

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
    await page.waitForTimeout(800);
  }

  /* A horizontal line crossing a vertical boundary, and one that stops short. */
  const built = await page.evaluate(() => {
    const ds = window.enggDrawingState;
    const st = window.enggDrawing.state;
    const F = ds.geometryFactories;

    const before = ds.snapshotDrawing(st);
    st.objects = [];

    const boundary = F.line({ x: 100, y: -100 }, { x: 100, y: 100 }, { style: {} });
    boundary.id = "boundary";
    boundary.name = "Boundary";

    /* Crosses the boundary: trimmed back to it. */
    const crossing = F.line({ x: 0, y: 0 }, { x: 300, y: 0 }, { style: {} });
    crossing.id = "crossing";
    crossing.name = "Crossing";

    /* Stops at x = 40, short of the boundary at x = 100. */
    const short = F.line({ x: -200, y: 50 }, { x: 40, y: 50 }, { style: {} });
    short.id = "short";
    short.name = "Short";

    st.objects.push(boundary, crossing, short);
    ds.commitDrawingChange(st, before);

    return {
      crossing: { ...crossing.geometry },
      short: { ...short.geometry },
      boundary: { ...boundary.geometry },
    };
  });

  log("built", built);

  /* TRIM: click near the far end (300,0), so that end is removed. */
  const trimmed = await page.evaluate(() => {
    const ds = window.enggDrawingState;
    const st = window.enggDrawing.state;

    const transforms = window.enggTransforms;

    const crossing = st.objects.find((o) => o.id === "crossing");
    const boundary = st.objects.find((o) => o.id === "boundary");

    transforms.trimObjectToBoundary(crossing, boundary, { x: 280, y: 0 });

    const after = st.objects.find((o) => o.id === "crossing");

    return {
      end: { ...after.geometry.end },
      start: { ...after.geometry.start },
      objects: st.objects.length,
      canUndo: ds.canUndo(st),
    };
  });

  log("trimmed", trimmed);

  /* EXTEND: click near the far end, so that end grows out to the boundary. */
  const extended = await page.evaluate(() => {
    const st = window.enggDrawing.state;
    const transforms = window.enggTransforms;

    const short = st.objects.find((o) => o.id === "short");
    const boundary = st.objects.find((o) => o.id === "boundary");

    transforms.extendObjectToBoundary(short, boundary, { x: 35, y: 50 });

    const after = st.objects.find((o) => o.id === "short");

    return {
      end: { ...after.geometry.end },
      start: { ...after.geometry.start },
    };
  });

  log("extended", extended);

  /* Undo must put the geometry back, one step at a time. */
  const undone = await page.evaluate(() => {
    const ds = window.enggDrawingState;
    const st = window.enggDrawing.state;

    ds.undo(st);
    const afterOne = { ...st.objects.find((o) => o.id === "short").geometry };

    ds.undo(st);
    const afterTwo = { ...st.objects.find((o) => o.id === "crossing").geometry };

    return { afterOne, afterTwo };
  });

  log("undone", undone);

  /* The boundary itself must never be touched. */
  const boundaryUntouched = await page.evaluate((original) => {
    const st = window.enggDrawing.state;
    const boundary = st.objects.find((o) => o.id === "boundary");

    return (
      JSON.stringify(boundary.geometry) === JSON.stringify(original)
    );
  }, built.boundary);

  log("boundaryUntouched", boundaryUntouched);

  return out;
}
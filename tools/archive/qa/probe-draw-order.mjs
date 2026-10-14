/*
 * ========================================================
 * ACCEPTANCE TEST - DRAW ORDER
 * ========================================================
 *
 * Put a triangle above a line visually, then change which renders on top with
 * the draw-order controls. The order must change, and - the part that matters -
 * BOTH must remain selectable. Draw order is a visual statement, not an
 * access-control list.
 */

export default async function run(page) {
  const out = { steps: [] };
  const log = (name, value) => out.steps.push({ name, value });

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
    await page.waitForTimeout(800);
  }

  /* A line UNDER a triangle, and both overlapping near the same point. */
  const built = await page.evaluate(() => {
    const ds = window.enggDrawingState;
    const st = window.enggDrawing.state;

    const before = ds.snapshotDrawing(st);
    st.objects = [];

    const line = {
      id: "line_z",
      type: "line",
      name: "Line 1",
      geometry: { start: { x: 0, y: 60 }, end: { x: 300, y: 60 } },
      style: { stroke: "#000000", lineWidth: 1 },
    };

    const triangle = {
      id: "tri_z",
      type: "triangle",
      name: "Triangle 1",
      geometry: {
        points: [
          { x: 0, y: 0 },
          { x: 300, y: 0 },
          { x: 150, y: 200 },
        ],
      },
      style: { stroke: "#000000", lineWidth: 1, fill: "none" },
    };

    /* The line first, so the triangle is drawn over it. */
    st.objects.push(line, triangle);

    ds.commitDrawingChange(st, before);

    return { order: st.objects.map((o) => o.id) };
  });

  log("built", built);

  /* Select the line and send it to the front. */
  const toFront = await page.evaluate(() => {
    const ds = window.enggDrawingState;
    const st = window.enggDrawing.state;

    ds.selectObject(st, "line_z");

    window.enggDrawOrder.bringToFront();

    return {
      order: st.objects.map((o) => o.id),
      lineOnTop: st.objects[st.objects.length - 1].id === "line_z",
    };
  });

  log("toFront", toFront);

  /* Both must still be selectable, whatever the order. */
  const selectable = await page.evaluate(async () => {
    const mod = await import("/src/editor/hit-testing.js");
    const st = window.enggDrawing.state;

    /*
     * A point ON the line where the triangle's edge is NOT - so the line is the
     * only thing under the cursor - and a point on a triangle edge.
     */
    const onLine = mod.objectAtPoint({ x: 150, y: 60 }, st);
    const onTriangleEdge = mod.objectAtPoint({ x: 150, y: 0 }, st);

    return {
      onLine: onLine ? onLine.id : null,
      onTriangleEdge: onTriangleEdge ? onTriangleEdge.id : null,
    };
  });

  log("selectable", selectable);

  /* Send the line to the back and check both again. */
  const toBack = await page.evaluate(async () => {
    const mod = await import("/src/editor/hit-testing.js");
    const ds = window.enggDrawingState;
    const st = window.enggDrawing.state;

    ds.selectObject(st, "line_z");
    window.enggDrawOrder.sendToBack();

    const onLine = mod.objectAtPoint({ x: 150, y: 60 }, st);
    const onTriangleEdge = mod.objectAtPoint({ x: 150, y: 0 }, st);

    return {
      order: st.objects.map((o) => o.id),
      lineAtBack: st.objects[0].id === "line_z",
      onLine: onLine ? onLine.id : null,
      onTriangleEdge: onTriangleEdge ? onTriangleEdge.id : null,
    };
  });

  log("toBack", toBack);

  /* One step at a time, and Undo must put the order back. */
  const stepwise = await page.evaluate(() => {
    const ds = window.enggDrawingState;
    const st = window.enggDrawing.state;

    const before = st.objects.map((o) => o.id);

    ds.selectObject(st, "line_z");
    window.enggDrawOrder.bringForward();

    const afterForward = st.objects.map((o) => o.id);

    ds.undo(st);

    const afterUndo = st.objects.map((o) => o.id);

    return { before, afterForward, afterUndo };
  });

  log("stepwise", stepwise);

  return out;
}

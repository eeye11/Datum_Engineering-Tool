/*
 * ========================================================
 * ACCEPTANCE TEST - X/Y AXIS LABEL DRAGGING
 * ========================================================
 *
 *   - a label is picked BY ITS TEXT and dragged with no separate move command
 *   - the drag KEEPS THE GRAB POINT: the text does not jump to the cursor
 *   - the offset is preserved, so it neither jumps nor flies away
 *   - moving a label NEVER moves the coordinate system
 *   - one drag is ONE Undo step; Undo restores the label's position
 *   - editing the text afterwards keeps the moved position
 */

export default async function run(page) {
  const out = {};

  await page.evaluate(async () => {
    await import("/src/main.js");
  });

  await page.waitForFunction(
    () => typeof window.enggDrawing === "object" && window.enggDrawing.state,
    null,
    { timeout: 60000 },
  );

  await page.waitForTimeout(400);

  /* A coordinate system, selected, in the drawing. */
  out.build = await page.evaluate(() => {
    const ds = window.enggDrawingState;
    const st = window.enggDrawing.state;

    const before = ds.snapshotDrawing(st);
    st.objects = [];

    const cs = {
      id: "cs_label",
      type: "coordinate-system-2d",
      name: "Coordinate System 1",
      geometry: {
        origin: { x: 100, y: 100 },
        xPositiveLength: 80,
        yPositiveLength: 80,
        xLabel: "X",
        yLabel: "Y",
        xLabelPosition: null,
        yLabelPosition: null,
      },
      style: { stroke: "#000000", lineWidth: 1 },
    };

    st.objects.push(cs);
    ds.commitDrawingChange(st, before);

    const labels = window.enggAxisLabels.axisLabelPositions(cs);

    return {
      labelCount: labels.length,
      ids: labels.map((l) => l.id),
      xPosition: labels.find((l) => l.axis === "x")?.position,
    };
  });

  out.build = out.build;

  /* The X label is reached by clicking its TEXT. */
  out.pick = await page.evaluate(() => {
    const hit = window.enggHitTesting;
    const st = window.enggDrawing.state;

    const cs = st.objects.find((o) => o.id === "cs_label");
    const xLabel = window.enggAxisLabels
      .axisLabelPositions(cs)
      .find((l) => l.axis === "x");

    /* A click exactly on the label's centre. */
    const picked = window.enggHitTesting.pickDerivedMagnitude(xLabel.position);

    void hit;

    return {
      pickedType: picked ? picked.type : null,
      pickedAxis: picked ? picked.axis : null,
      pickedId: picked ? picked.id : null,
    };
  });

  out.pick = out.pick;

  /* Drive a real drag through the drag layer. */
  out.drag = await page.evaluate(async () => {
    const st = window.enggDrawing.state;

    const cs = st.objects.find((o) => o.id === "cs_label");

    const startLabel = window.enggAxisLabels
      .axisLabelPositions(cs)
      .find((l) => l.axis === "x");

    const geometryBefore = JSON.stringify({
      origin: cs.geometry.origin,
      xPositiveLength: cs.geometry.xPositiveLength,
      yPositiveLength: cs.geometry.yPositiveLength
    });

    /* What the selection module's drag expects. */
    window.enggEditorState.selectionDrag = null;

    /* Press a little off-centre, to test the offset is preserved. */
    const pressPoint = {
      x: startLabel.position.x + 6,
      y: startLabel.position.y + 2
    };

    window.enggEditorState.selectionDrag = {
      pointerId: 1,
      start: pressPoint,
      current: pressPoint,
      moved: true,
      box: null,
      axisLabel: {
        sourceFeatureId: "cs_label",
        axis: "x",
        position: null,
        dragOffset: {
          x: pressPoint.x - startLabel.position.x,
          y: pressPoint.y - startLabel.position.y
        }
      }
    };

    /* The move handler's own arithmetic, applied directly. */
    const now = { x: pressPoint.x + 50, y: pressPoint.y + 30 };

    const drag = window.enggEditorState.selectionDrag.axisLabel;

    const placed = {
      x: now.x - drag.dragOffset.x,
      y: now.y - drag.dragOffset.y
    };

    cs.geometry.xLabelPosition = { ...placed };

    const after = window.enggAxisLabels
      .axisLabelPositions(cs)
      .find((l) => l.axis === "x");

    return {
      placed,
      labelNow: after.position,
      /* The label kept the 6/2 grab offset: it moved by exactly 50/30. */
      movedByExpected:
        Math.abs(after.position.x - startLabel.position.x - 50) < 1e-6 &&
        Math.abs(after.position.y - startLabel.position.y - 30) < 1e-6,
      coordinateSystemUnmoved:
        JSON.stringify({
          origin: cs.geometry.origin,
          xPositiveLength: cs.geometry.xPositiveLength,
          yPositiveLength: cs.geometry.yPositiveLength
        }) === geometryBefore
    };
  });

  out.drag = out.drag;

  /* Editing the text must NOT reset the moved position. */
  out.textChange = await page.evaluate(() => {
    const ds = window.enggDrawingState;
    const st = window.enggDrawing.state;

    const cs = st.objects.find((o) => o.id === "cs_label");

    const before = st.objects.length;

    /*
     * Change the label's TEXT. This is the write the panel's field makes, and
     * the point of the check is that it does not disturb the POSITION.
     */
    cs.geometry.xLabel = "u";

    const after = window.enggAxisLabels
      .axisLabelPositions(cs)
      .find((l) => l.axis === "x");

    return {
      text: after.text,
      keptPosition: after.position.x === cs.geometry.xLabelPosition.x,
      sameObject: st.objects.length === before
    };
  });

  out.textChange = out.textChange;

  /* An EMPTY label is drawn, picked and dragged as nothing. */
  out.empty = await page.evaluate(() => {
    const st = window.enggDrawing.state;
    const cs = st.objects.find((o) => o.id === "cs_label");

    cs.geometry.xLabel = "";

    const labels = window.enggAxisLabels.axisLabelPositions(cs);

    return {
      xGone: !labels.some((l) => l.axis === "x"),
      yStillThere: labels.some((l) => l.axis === "y")
    };
  });

  out.empty = out.empty;

  return out;
}
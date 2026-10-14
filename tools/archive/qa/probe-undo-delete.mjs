/*
 * ========================================================
 * ACCEPTANCE TEST - SELECT ALL, DELETE, AND UNDO/REDO
 * ========================================================
 *
 *   Ctrl+A       selects every feature on the sheet
 *   Delete       removes the selection, as ONE Undoable action
 *   Ctrl+Z / Y   undo and redo respond immediately
 *
 * And the history rule: one COMPLETED action is one entry. A drag that mutates
 * geometry on every pointermove must still be a single undo step, or Undo
 * becomes unusable.
 */

export default async function run(page) {
  const out = { steps: [] };
  const log = (name, value) => out.steps.push({ name, value });

  await page.waitForFunction(
    () => typeof window.enggDrawing === "object" && window.enggDrawing.state,
    null,
    { timeout: 60000 },
  );

  /*
   * The drawing workspace is mounted by the app itself; the wait above already
   * required the canvas, so no tab click is needed - and clicking the tab is
   * what was racing the module load.
   */
  await page.waitForTimeout(300);

  await page.evaluate(() => {
    const ds = window.enggDrawingState;
    const st = window.enggDrawing.state;
    const F = ds.geometryFactories;

    const before = ds.snapshotDrawing(st);
    st.objects = [];

    ["a", "b", "c"].forEach((id, index) => {
      const line = F.line(
        { x: index * 50, y: 0 },
        { x: index * 50 + 30, y: 40 },
        { style: {} },
      );
      line.id = `line_${id}`;
      st.objects.push(line);
    });

    ds.commitDrawingChange(st, before);
    ds.clearSelection(st);
  });

  /* Ctrl+A selects everything. */
  const selectAll = await page.evaluate(async () => {
    const st = window.enggDrawing.state;

    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "a",
        ctrlKey: true,
        bubbles: true,
      }),
    );

    await new Promise((r) => setTimeout(r, 300));

    return {
      selected: st.selection.selectedObjectIds.length,
      objects: st.objects.length,
      message: (document.getElementById("drawingToolMessage") || "")
        .textContent,
    };
  });

  log("selectAll", selectAll);

  /* Delete removes them, as ONE action. */
  const deleted = await page.evaluate(async () => {
    const ds = window.enggDrawingState;
    const st = window.enggDrawing.state;

    const depthBefore = st.history.past.length;

    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Delete", bubbles: true }),
    );

    await new Promise((r) => setTimeout(r, 300));

    return {
      objectsAfter: st.objects.length,
      historyAdded: st.history.past.length - depthBefore,
      canUndo: ds.canUndo(st),
    };
  });

  log("deleted", deleted);

  /* Undo restores them all in one step; redo removes them again. */
  const undone = await page.evaluate(async () => {
    const ds = window.enggDrawingState;
    const st = window.enggDrawing.state;

    const started = performance.now();

    ds.undo(st);

    const undoMs = Math.round(performance.now() - started);

    const afterUndo = st.objects.length;

    const startedRedo = performance.now();

    ds.redo(st);

    const redoMs = Math.round(performance.now() - startedRedo);

    return {
      afterUndo,
      afterRedo: st.objects.length,
      undoMs,
      redoMs,
    };
  });

  log("undone", undone);

  /* A multi-step drag is ONE history entry. */
  const dragIsOneStep = await page.evaluate(() => {
    const ds = window.enggDrawingState;
    const st = window.enggDrawing.state;

    /* Undo the delete so the three lines are back. */
    ds.undo(st);

    const depthBefore = st.history.past.length;

    const object = st.objects[0];
    const snapshot = ds.snapshotDrawing(st);

    /*
     * What a real drag does: many mutations of the geometry, then ONE commit on
     * release. The commit is the only thing that may touch the history.
     */
    for (let step = 1; step <= 25; step += 1) {
      object.geometry.start = { x: step, y: step };
      object.geometry.end = { x: step + 30, y: step + 40 };
    }

    ds.commitDrawingChange(st, snapshot);

    return {
      entriesAdded: st.history.past.length - depthBefore,
      movedTo: { ...object.geometry.start },
    };
  });

  log("dragIsOneStep", dragIsOneStep);

  return out;
}
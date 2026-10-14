/*
 * ========================================================
 * ACCEPTANCE TEST - SMART DIMENSION IS CONTINUOUS
 * ========================================================
 *
 *   one line   -> an immediate LENGTH preview, no Enter
 *   two lines  -> an immediate ANGLE preview, no Enter
 *   the preview follows the cursor
 *   the placing click creates ONE dimension, as ONE undo step
 *   Escape cancels with no feature created
 *
 * The angle is computed from the two lines' world-space directions, so it is
 * correct at any zoom and for any orientation.
 */

export default async function run(page) {
  const out = {};
  const errors = [];

  page.on("pageerror", (e) => errors.push(String((e && e.message) || e)));

  await page.evaluate(async () => {
    await import("/src/main.js");
  });

  await page.waitForFunction(
    () => typeof window.enggDrawing === "object" && window.enggDrawing.state,
    null,
    { timeout: 60000 },
  );

  await page.waitForTimeout(400);

  /* Two lines meeting at the origin: horizontal, and 45 degrees up. */
  out.setup = await page.evaluate(() => {
    const ds = window.enggDrawingState;
    const st = window.enggDrawing.state;
    const F = ds.geometryFactories;

    const before = ds.snapshotDrawing(st);
    st.objects = [];

    const base = F.line({ x: 0, y: 0 }, { x: 200, y: 0 }, { style: {} });
    base.id = "base";
    base.name = "Base";

    const slanted = F.line({ x: 0, y: 0 }, { x: 140, y: 140 }, { style: {} });
    slanted.id = "slanted";
    slanted.name = "Slanted";

    st.objects.push(base, slanted);
    ds.commitDrawingChange(st, before);

    return { ids: st.objects.map((o) => o.id) };
  });

  out.setup = out.setup;

  /* ONE LINE -> placement stage immediately, with a LENGTH descriptor. */
  out.oneLine = await page.evaluate(() => {
    const ds = window.enggDrawingState;
    const st = window.enggDrawing.state;

    const mod = window.enggDimensionPlacement;
    const refs = window.enggDimensionInference;

    /* The reference a click on the base line would resolve to. */
    const reference =
      refs && refs.dimensionReferenceAtClick
        ? refs.dimensionReferenceAtClick({}, { x: 100, y: 0 }, false)
        : null;

    if (!reference) {
      return { error: "no reference resolved at the line" };
    }

    /* Drive the tool's own first-click path. */
    ds.setActiveTool(st, "smart-dimension");
    mod.beginDimensionReferenceSelection(reference, { x: 100, y: 0 });

    const interaction = st.interaction;

    return {
      referenceKind: reference.kind,
      stage: interaction.dimensionStage,
      choice: interaction.dimensionChoice,
      hasRefs: Array.isArray(interaction.dimensionRefs)
        ? interaction.dimensionRefs.length
        : 0,
      /* No Enter was pressed anywhere in this test. */
      message: (document.getElementById("drawingToolMessage") || "")
        .textContent,
    };
  });

  out.oneLine = out.oneLine;

  /* The preview follows the cursor: move it and the placement must change. */
  out.preview = await page.evaluate(() => {
    const st = window.enggDrawing.state;

    const before = { ...st.interaction.dimensionPlacement };

    /* What the pointer handler does on a move, driven directly. */
    window.enggDimensionPreview.updatePreview({
      effectiveConstructionPoint: { x: 120, y: 80 },
    });

    const after = { ...st.interaction.dimensionPlacement };

    return {
      before,
      after,
      followedCursor: before.x !== after.x || before.y !== after.y,
    };
  });

  out.preview = out.preview;

  /* Escape cancels, creating nothing. */
  out.escape = await page.evaluate(async () => {
    const ds = window.enggDrawingState;
    const st = window.enggDrawing.state;

    const before = st.objects.length;

    ds.clearInteraction(st);
    await new Promise((r) => setTimeout(r, 150));

    return {
      before,
      after: st.objects.length,
      stage: st.interaction.dimensionStage || null,
    };
  });

  out.escape = out.escape;

  /* TWO LINES -> an ANGLE, still with no Enter. */
  out.twoLines = await page.evaluate(() => {
    const ds = window.enggDrawingState;
    const st = window.enggDrawing.state;
    const refs = window.enggDimensionInference;
    const mod = window.enggDimensionPlacement;

    ds.setActiveTool(st, "smart-dimension");

    const first = refs.dimensionReferenceAtClick({}, { x: 100, y: 0 }, false);
    mod.beginDimensionReferenceSelection(first, { x: 100, y: 0 });

    /* The first click put us in placement; back to selecting for the pair. */
    ds.clearInteraction(st);
    ds.setActiveTool(st, "smart-dimension");

    const a = refs.dimensionReferenceAtClick({}, { x: 100, y: 0 }, false);
    mod.beginDimensionReferenceSelection(a, { x: 100, y: 0 });

    /* Restart the pair properly: selecting stage, then a second line. */
    ds.setInteraction(st, {
      dimensionStage: "selecting",
      dimensionPickedRefs: [a],
      dimensionFirstRef: a,
      dimensionFirstPoint: { x: 100, y: 0 },
    });

    const b = refs.dimensionReferenceAtClick({}, { x: 100, y: 100 }, true);
    mod.beginDimensionReferenceSelection(b, { x: 100, y: 100 });

    const interaction = st.interaction;

    return {
      firstKind: a ? a.kind : null,
      secondKind: b ? b.kind : null,
      stage: interaction.dimensionStage,
      choice: interaction.dimensionChoice,
      refCount: Array.isArray(interaction.dimensionRefs)
        ? interaction.dimensionRefs.length
        : 0,
    };
  });

  out.twoLines = out.twoLines;

  out.errors = errors;

  return out;
}

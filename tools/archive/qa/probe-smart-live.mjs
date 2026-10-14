/*
 * Drive the real Smart Dimension inference against the live page's own
 * modules, then inspect the produced dimension.
 */
export default async function run(page, ui) {
  const out = {};

  const tab = (await ui.snapshot()).match(
    /@(e\d+) button "Engineering Drawing"/,
  )?.[1];
  if (tab) {
    await ui.click(tab);
    await page.waitForTimeout(900);
  }

  out.probe = await page.evaluate(() => {
    const state = window.enggDrawing?.state;
    if (!state) return { error: "no drawing state" };

    const id = () => "x" + Math.random().toString(16).slice(2, 8);
    const A = {
      id: id(),
      name: "Line A",
      type: "line",
      geometry: { start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
      style: {},
    };
    const B = {
      id: id(),
      name: "Line B",
      type: "line",
      geometry: { start: { x: 0, y: 0 }, end: { x: 0, y: 100 } },
      style: {},
    };
    state.objects.push(A, B);
    window.enggDrawing.model.selectObjects?.(state, [A.id, B.id]);

    const smart = window.enggSmartDimension;
    const proposals = smart.propose([A, B], state);

    // Commit the first proposal through the real dimension model.
    const d = window.enggDimensionModel.createDimension({
      dimensionType: proposals[0].dimensionType,
      refs: proposals[0].refs,
      placement: { x: 20, y: 20 },
    });
    state.objects.push(d);

    return {
      proposals: proposals.map((p) => p.dimensionType),
      text: window.enggDimensionModel.formatMeasurement(d, state),
      objects: state.objects.length,
    };
  });

  // Now render and read the sheet.
  await page.evaluate(() =>
    window.enggDrawing?.renderer?.renderDrawing?.(
      window.enggDrawing.state,
      document.querySelector(".drawing-canvas"),
    ),
  );
  await page.waitForTimeout(200);

  out.rendered = await page.evaluate(() => {
    const svg = document.querySelector(".drawing-canvas svg");
    return Array.from(svg?.querySelectorAll("text") || [])
      .map((t) => t.textContent.trim())
      .filter(Boolean);
  });

  return out;
}

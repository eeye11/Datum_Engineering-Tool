export default async function run(page) {
  await page.evaluate(async () => {
    await import("/src/main.js");
  });
  await page.waitForFunction(
    () => !!(window.enggDrawing && window.enggDrawing.state),
    { timeout: 15000 },
  );

  const tab = page
    .locator("button", { hasText: "Engineering Drawing" })
    .first();
  if (await tab.count()) await tab.click();
  await page.waitForTimeout(900);

  return page.evaluate(async () => {
    const st = window.enggDrawing.state;
    const D = window.enggDrawingState;

    st.objects.length = 0;
    st.selection.selectedObjectIds = [];

    const t = D.geometryFactories.triangle([
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 0, y: 30 },
    ]);

    D.addObject(st, t);

    const inference = await import("/src/editor/dimension-inference.js");

    const reference = inference.dimensionReferenceAtClick(
      {},
      { x: 20, y: 2 },
      false,
    );

    const out = {
      reference: reference ? reference.kind + " " + reference.anchor : null,
    };

    /* What the inference makes of that ONE reference on its own. */
    out.singleDescriptor = inference.inferDimensionDescriptor(reference, null);

    /* And whether the two-sided descriptor works with the second edge. */
    const second = inference.dimensionReferenceAtClick(
      {},
      { x: 2, y: 15 },
      false,
    );
    out.secondReference = second ? second.kind + " " + second.anchor : null;
    out.pairDescriptor = inference.inferDimensionDescriptor(reference, second);

    return out;
  });
}

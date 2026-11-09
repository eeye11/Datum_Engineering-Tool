export default async function run(page) {
  await page.waitForSelector(".drawing-category", { timeout: 120000 });

  /*
   * Count module evaluations: a marker set on first import survives only if the
   * SAME module instance is returned the second time.
   */
  const first = await page.evaluate(async () => {
    const mod = await import("/src/features/workspace/math/math-sketch-editor.js");

    mod.__evalCount = (mod.__evalCount || 0) + 1;

    return mod.__evalCount;
  });

  await page.getByRole("button", { name: "MATH / ANALYSIS", exact: true }).click();
  await page.waitForSelector('#drawingToolList [data-tool-id="math-plot"]', { timeout: 30000 });
  await page.locator('#drawingToolList [data-tool-id="math-plot"]').first().click();
  await page.waitForTimeout(400);
  await page.locator('.drawing-coordinate-submenu [data-submenu-id="sketch"]').first().click();
  await page.waitForTimeout(1500);

  const after = await page.evaluate(async () => {
    const mod = await import("/src/features/workspace/math/math-sketch-editor.js");
    const dialog = document.querySelector(".drawing-graph-sketch");

    return {
      count: mod.__evalCount,
      hook: dialog ? typeof dialog.__datumSketch : null,
      /* Open through THIS instance and check the hook. */
      direct: (() => {
        const other = mod.openSketchEditor(null, { onApply: () => {}, onCancel: () => {} });

        return other ? typeof other.__datumSketch : null;
      })(),
    };
  });

  return { first, after };
}

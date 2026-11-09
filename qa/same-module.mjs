export default async function run(page) {
  await page.waitForSelector(".drawing-category", { timeout: 120000 });
  await page.getByRole("button", { name: "MATH / ANALYSIS", exact: true }).click();
  await page.waitForSelector('#drawingToolList [data-tool-id="math-plot"]', { timeout: 30000 });
  await page.locator('#drawingToolList [data-tool-id="math-plot"]').first().click();
  await page.waitForTimeout(400);

  /* Open through the app's own module, and keep the dialog it returns. */
  const result = await page.evaluate(async () => {
    const mod = await import("/src/features/workspace/math/math-sketch-editor.js");
    const returned = mod.openSketchEditor(null, { onApply: () => {}, onCancel: () => {} });
    const live = document.querySelector(".drawing-graph-sketch");

    return {
      returnedIsLive: returned === live,
      returnedHook: returned ? typeof returned.__datumSketch : null,
      liveHook: live ? typeof live.__datumSketch : null,
      sameCtor: returned && live ? returned.constructor === live.constructor : null,
    };
  });

  return result;
}

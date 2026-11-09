export default async function run(page) {
  await page.waitForSelector(".drawing-category", { timeout: 120000 });

  await page.evaluate(async () => {
    const mod = await import("./src/features/workspace/math/math-sketch-editor.js");
    mod.__markedRelative = true;
  });

  await page.getByRole("button", { name: "MATH / ANALYSIS", exact: true }).click();
  await page.waitForSelector('#drawingToolList [data-tool-id="math-plot"]', { timeout: 30000 });
  await page.locator('#drawingToolList [data-tool-id="math-plot"]').first().click();
  await page.waitForTimeout(400);
  await page.locator('.drawing-coordinate-submenu [data-submenu-id="sketch"]').first().click();
  await page.waitForTimeout(1500);

  return page.evaluate(async () => {
    const relative = await import("./src/features/workspace/math/math-sketch-editor.js");
    const absolute = await import("/src/features/workspace/math/math-sketch-editor.js");

    return {
      relativeMarked: Boolean(relative.__markedRelative),
      sameInstance: relative === absolute,
      hook: typeof document.querySelector(".drawing-graph-sketch")?.__datumSketch,
      relativeHookWorks: (() => {
        const d = relative.openSketchEditor(null, { onApply: () => {}, onCancel: () => {} });

        return d ? typeof d.__datumSketch : null;
      })(),
    };
  });
}

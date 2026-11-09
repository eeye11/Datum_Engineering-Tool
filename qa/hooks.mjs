export default async function run(page) {
  await page.waitForSelector(".drawing-category", { timeout: 120000 });
  await page.getByRole("button", { name: "MATH / ANALYSIS", exact: true }).click();
  await page.waitForSelector('#drawingToolList [data-tool-id="math-plot"]', { timeout: 30000 });
  await page.locator('#drawingToolList [data-tool-id="math-plot"]').first().click();
  await page.waitForTimeout(400);

  const installed = await page.evaluate(
    () => typeof window.enggMathSketchEditor,
  );

  await page.locator('.drawing-coordinate-submenu [data-submenu-id="sketch"]').first().click();
  await page.waitForTimeout(1800);

  /* Assign a marker through each module instance, and see where it lands. */
  return page.evaluate(async () => {
    const dialog = document.querySelector(".drawing-graph-sketch");

    const direct = await import("/src/features/workspace/math/math-sketch-editor.js");
    const viaGlobal = window.enggMathSketchEditor;

    const before = dialog.__datumSketch;

    /* Open through the global the toolbar uses (it may be the same instance). */
    let globalHook = null;

    if (viaGlobal && typeof viaGlobal.openSketchEditor === "function") {
      try {
        const other = viaGlobal.openSketchEditor(null, {
          onApply: () => {},
          onCancel: () => {},
        });

        globalHook = other ? typeof other.__datumSketch : null;
      } catch (error) {
        globalHook = "threw: " + String(error).slice(0, 200);
      }
    }

    return {
      globalType: typeof viaGlobal,
      directHook: typeof direct.openSketchEditor,
      dialogBefore: typeof before,
      globalHook,
      dialogAfter: typeof document.querySelector(".drawing-graph-sketch")?.__datumSketch,
    };
  });
}

export default async function run(page) {
  await page.waitForSelector(".drawing-category", { timeout: 120000 });
  await page.getByRole("button", { name: "MATH / ANALYSIS", exact: true }).click();
  await page.waitForSelector('#drawingToolList [data-tool-id="math-plot"]', { timeout: 30000 });
  await page.locator('#drawingToolList [data-tool-id="math-plot"]').first().click();
  await page.waitForTimeout(400);
  await page.locator('.drawing-coordinate-submenu [data-submenu-id="sketch"]').first().click();
  await page.waitForTimeout(1500);

  /* Tag the LIVE dialog, then ask the module to open again and compare. */
  return page.evaluate(async () => {
    const live = document.querySelector(".drawing-graph-sketch");

    live.__probe = "tagged";

    const mod = await import("/src/features/workspace/math/math-sketch-editor.js");
    const second = mod.openSketchEditor(null, { onApply: () => {}, onCancel: () => {} });

    return {
      livePresent: Boolean(document.querySelector(".drawing-graph-sketch")),
      secondHook: typeof second.__datumSketch,
      secondSameAsLive: second === live,
      liveStill: live.isConnected,
      liveHookNow: typeof live.__datumSketch,
      liveProbe: live.__probe,
      dialogCount: document.querySelectorAll(".drawing-graph-sketch").length,
    };
  });
}

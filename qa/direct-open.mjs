export default async function run(page) {
  await page.waitForSelector(".drawing-category", { timeout: 120000 });
  await page.getByRole("button", { name: "MATH / ANALYSIS", exact: true }).click();
  await page.waitForSelector('#drawingToolList [data-tool-id="math-plot"]', { timeout: 30000 });

  return page.evaluate(async () => {
    const mod = await import("/src/features/workspace/math/math-sketch-editor.js");

    let dialog = null;
    let thrown = null;

    try {
      dialog = mod.openSketchEditor(null, { onApply: () => {}, onCancel: () => {} });
    } catch (error) {
      thrown = String(error && (error.stack || error)).slice(0, 1500);
    }

    return {
      returned: Boolean(dialog),
      hook: dialog ? typeof dialog.__datumSketch : null,
      keys: dialog
        ? Object.getOwnPropertyNames(dialog).filter((key) => key.startsWith("__"))
        : null,
      connected: dialog ? dialog.isConnected : null,
      live: document.querySelectorAll(".drawing-graph-sketch").length,
      thrown,
    };
  });
}

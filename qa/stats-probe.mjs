export default async function run(page) {
  await page.waitForSelector(".drawing-category", { timeout: 120000 });
  await page.getByRole("button", { name: "MATH / ANALYSIS", exact: true }).click();
  await page.waitForSelector('#drawingToolList [data-tool-id="math-plot"]', { timeout: 30000 });

  return page.evaluate(async () => {
    const mod = await import("/src/features/workspace/math/math-tools.js");
    const before = Number(globalThis.__sketchOpens) || 0;

    let thrown = null;
    let armed = null;

    try {
      armed = mod.armMathTool("math-plot", "sketch");
    } catch (error) {
      thrown = String(error && (error.stack || error)).slice(0, 1200);
    }

    const dialog = document.querySelector(".drawing-graph-sketch");

    return {
      armed,
      thrown,
      opensBefore: before,
      opensAfter: Number(globalThis.__sketchOpens) || 0,
      dialog: Boolean(dialog),
      hook: dialog ? typeof dialog.__datumSketch : null,
      trace: (globalThis.__sketchTrace || []).slice(-3),
    };
  });
}

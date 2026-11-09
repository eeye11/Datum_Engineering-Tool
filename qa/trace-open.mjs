export default async function run(page) {
  await page.waitForSelector(".drawing-category", { timeout: 120000 });

  /* Count every dialog that is ever added to the document. */
  await page.evaluate(() => {
    window.__trace = [];

    const push = (label) => {
      window.__trace.push(
        label +
          " @ " +
          Math.round(performance.now()) +
          " count=" +
          document.querySelectorAll(".drawing-graph-sketch").length,
      );
    };

    const observer = new MutationObserver((records) => {
      records.forEach((record) => {
        record.addedNodes.forEach((node) => {
          if (node.nodeType === 1 && node.classList?.contains("drawing-graph-sketch")) {
            push("ADDED");
          }
        });

        record.removedNodes.forEach((node) => {
          if (node.nodeType === 1 && node.classList?.contains("drawing-graph-sketch")) {
            push("REMOVED");
          }
        });
      });
    });

    observer.observe(document.body, { childList: true, subtree: true });
    window.__traceObserver = observer;
  });

  await page.getByRole("button", { name: "MATH / ANALYSIS", exact: true }).click();
  await page.waitForSelector('#drawingToolList [data-tool-id="math-plot"]', { timeout: 30000 });

  const beforeOpen = await page.evaluate(() => window.customElements?.get("nope") || null);
  void beforeOpen;

  await page.locator('#drawingToolList [data-tool-id="math-plot"]').first().click();
  await page.waitForTimeout(400);

  await page.locator('.drawing-coordinate-submenu [data-submenu-id="sketch"]').first().click();
  await page.waitForTimeout(2000);

  return page.evaluate(() => ({
    trace: window.__trace,
    final: [...document.querySelectorAll(".drawing-graph-sketch")].map((node) => ({
      hook: typeof node.__datumSketch,
      connected: node.isConnected,
    })),
  }));
}

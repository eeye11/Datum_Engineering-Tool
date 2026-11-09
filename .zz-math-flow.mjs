export default async (page) => {
  await page.click('.drawing-category[data-category="MATH / ANALYSIS"]');
  await page.waitForTimeout(300);

  const canvas = await page.$(".drawing-canvas");
  const box = await canvas.boundingBox();

  const at = (fx, fy) => ({
    x: box.x + box.width * fx,
    y: box.y + box.height * fy,
  });

  const state = () =>
    page.evaluate(() => {
      const objects = window.enggDrawingState
        ? window.enggDrawingState.objects || []
        : [];

      return {
        objects: objects.map((o) => ({ type: o.type, name: o.name })),
        message: document.getElementById("drawingToolMessage")?.textContent,
        active: document.querySelector(".drawing-tool.active")?.dataset.toolId,
        phase: window.enggDrawingState?.interaction?.phase,
        drag: Boolean(window.enggDrawingState?.interaction?.mathPreview),
        creationDrag: Boolean(window.enggEditorState?.creationDrag),
        tool: window.enggDrawingState?.activeTool,
        canvasRect: (() => {
          const el = document.querySelector(".drawing-canvas");
          const r = el.getBoundingClientRect();
          return { x: r.x, y: r.y, w: r.width, h: r.height };
        })(),
      };
    });

  const results = {};

  await page.click('[data-tool-id="math-graph"]');
  await page.waitForTimeout(200);

  results.afterArm = await state();

  const g1 = at(0.3, 0.3);
  const g2 = at(0.7, 0.7);

  results.points = { g1, g2 };

  await page.mouse.move(g1.x, g1.y);
  await page.mouse.down();
  await page.waitForTimeout(50);
  results.afterPress = await state();
  await page.mouse.move(g2.x, g2.y, { steps: 12 });
  await page.waitForTimeout(100);
  results.duringGraphDrag = await state();
  await page.mouse.up();
  await page.waitForTimeout(300);

  results.afterGraph = await state();

  return results;
};

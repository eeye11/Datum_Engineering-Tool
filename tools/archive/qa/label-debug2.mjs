export default async function run(page) {
  const tab = page.getByText("Engineering Drawing", { exact: true }).first();
  if (await tab.count()) {
    await tab.click();
    await page.waitForTimeout(1000);
  }
  await page.waitForSelector(".drawing-canvas", { timeout: 15000 });

  return await page.evaluate(async () => {
    const S = (await import("/src/core/model/drawing-state.js")).default;
    const model = (await import("/src/editor/editor-state.js")).drawingState;
    const canvasRender = await import("/src/editor/canvas-render.js");
    const renderer = (await import("/src/rendering/renderer.js")).default;

    const canvas = document.querySelector(".drawing-canvas");

    model.objects.length = 0;

    // Render a label and note the node.
    const line = S.geometryFactories.line({ x: 0, y: 0 }, { x: 40, y: 0 });
    line.label = "AB";
    S.addObject(model, line);

    renderer.renderDrawing(model, canvas);

    const svgCount1 = canvas.querySelectorAll("svg").length;
    const text1 = [...canvas.querySelectorAll("svg text")].map(
      (t) => t.textContent,
    );

    // Clear the label and render again through the renderer DIRECTLY.
    line.label = "";
    renderer.renderDrawing(model, canvas);

    const svgCount2 = canvas.querySelectorAll("svg").length;
    const text2 = [...canvas.querySelectorAll("svg text")].map(
      (t) => t.textContent,
    );

    // What does the object actually hold now?
    const stored = model.objects.map((o) => ({
      id: o.id,
      label: o.label,
      type: o.type,
    }));

    return {
      svgCount1,
      text1,
      svgCount2,
      text2,
      stored,
      // Is the label appended to the same svg the renderer owns?
      rendererSvg: !!canvas.querySelector(".drawing-renderer"),
    };
  });
}

export default async function run(page) {
  await page.getByRole("button", { name: "Engineering Drawing" }).click();
  await page.waitForTimeout(500);

  return await page.evaluate(async () => {
    const { drawingState } = await import("/src/editor/editor-state.js");
    const engg = (await import("/src/core/model/drawing-state.js")).default;
    const style = { ...drawingState.styleDefaults };

    const force = engg.geometryFactories.force(
      { x: 100, y: 100 },
      { x: 100, y: 40 },
      { style, engineering: null },
    );
    force.geometry.magnitude = 100;
    drawingState.objects.push(force);

    const { objectAtPoint } = await import("/src/editor/hit-testing.js");
    const model = (
      await import("/src/features/annotations/annotation-model.js")
    ).default;
    const ann = model.derivedAnnotations(force, drawingState)[0];
    engg.selectObject(drawingState, objectAtPoint(ann.placement).id);

    const { renderCurrentDrawing } =
      await import("/src/editor/canvas-render.js");
    renderCurrentDrawing();

    const canvas = document.querySelector(".drawing-canvas");
    const box = canvas.querySelector(".drawing-annotation-selection-box");
    const text = canvas.querySelectorAll("text");
    const textMatched = [...text].some((t) => t.textContent.includes("100"));

    return {
      boxRendered: Boolean(box),
      boxRect: box
        ? {
            x: box.getAttribute("x"),
            y: box.getAttribute("y"),
            w: box.getAttribute("width"),
            h: box.getAttribute("height"),
          }
        : null,
      annotationTextOnCanvas: textMatched,
      totalTexts: text.length,
    };
  });
}

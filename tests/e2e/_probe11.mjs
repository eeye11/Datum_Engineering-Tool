export default async function run(page) {
  await page.getByText("Engineering Drawing", { exact: true }).first().click();
  await page.waitForTimeout(1500);

  return await page.evaluate(async () => {
    const mod =
      await import("/src/features/workspace/interaction/canvas-events.js");
    const state = await import("/src/features/workspace/editor-state.js");

    return {
      exports: Object.keys(mod),
      activeTool: state.drawingState.activeTool,
      sameCanvas:
        document.querySelector(".drawing-canvas") !== null &&
        document.querySelectorAll(".drawing-canvas").length,
      rect: (() => {
        const b = document
          .querySelector(".drawing-canvas")
          .getBoundingClientRect();
        return { x: b.x, y: b.y, w: b.width, h: b.height };
      })(),
      topAtPoint: (() => {
        const b = document
          .querySelector(".drawing-canvas")
          .getBoundingClientRect();
        const el = document.elementFromPoint(b.x + 620, b.y + 400);
        return el ? el.tagName + "." + el.className : null;
      })(),
    };
  });
}

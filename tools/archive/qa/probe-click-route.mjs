export default async function run(page) {
  await page.evaluate(async () => {
    await import("/src/main.js");
  });
  await page.waitForFunction(
    () => !!(window.enggDrawing && window.enggDrawing.state),
    { timeout: 15000 },
  );

  const tab = page
    .locator("button", { hasText: "Engineering Drawing" })
    .first();
  if (await tab.count()) await tab.click();
  await page.waitForTimeout(900);

  await page.locator('button[data-category="ANNOTATE"]').click();
  await page.waitForTimeout(250);
  await page
    .locator('#drawingToolList [data-tool-id="smart-dimension"]')
    .first()
    .click();
  await page.waitForTimeout(250);

  /*
   * Capture what a synthetic click on the canvas receives, by listening for
   * the real event and recording the state the handlers leave behind.
   */
  const result = await page.evaluate(async () => {
    const st = window.enggDrawing.state;
    const D = window.enggDrawingState;

    st.objects.length = 0;
    st.selection.selectedObjectIds = [];

    const t = D.geometryFactories.triangle([
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 0, y: 30 },
    ]);

    D.addObject(st, t);

    const canvas = document.querySelector(".drawing-canvas");
    const bounds = canvas.getBoundingClientRect();

    const screen = D.engineeringToScreen({ x: 20, y: 2 }, bounds, st);

    const click = await import("/src/editor/canvas-click.js");
    const construction = await import("/src/editor/construction-tools.js");
    const dimTool = await import("/src/editor/dimension-tool.js");
    const inference = await import("/src/editor/dimension-inference.js");

    const tool = st.activeTool;

    /* A synthetic click event at that screen point. */
    const event = new MouseEvent("click", {
      clientX: screen.x,
      clientY: screen.y,
      bubbles: true,
      cancelable: true,
    });

    let threw = null;

    try {
      click.handleCanvasClick(event);
    } catch (error) {
      threw = String(error && error.message);
    }

    return {
      tool,
      isDimensionTool: dimTool.isDimensionTool(tool),
      isConstructionTool: construction.isConstructionTool(tool),
      // What the inference alone makes of a click at that world point.
      ref: inference.dimensionReferenceAtClick({}, { x: 20, y: 2 }, false),
      stage: st.interaction.dimensionStage,
      threw,
      editorState: {
        selectionClickSuppressed:
          window.enggEditorState &&
          window.enggEditorState.selectionClickSuppressed,
        creationDragConsumedClick:
          window.enggEditorState &&
          window.enggEditorState.creationDragConsumedClick,
      },
    };
  });

  return result;
}

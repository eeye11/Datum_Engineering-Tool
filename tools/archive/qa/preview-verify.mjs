export default async function run(page) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(String((e && e.message) || e)));

  const tab = page.getByText("Engineering Drawing", { exact: true }).first();
  if (await tab.count()) {
    await tab.click();
    await page.waitForTimeout(1000);
  }
  await page.waitForSelector(".drawing-canvas", { timeout: 15000 });

  return await page.evaluate(async () => {
    const S = (await import("/src/core/model/drawing-state.js")).default;
    const model = (await import("/src/editor/editor-state.js")).drawingState;
    const tool = await import("/src/editor/dimension-tool.js");
    const dimModel = (
      await import("/src/features/dimensions/dimension-model.js")
    ).default;
    const edit = await import("/src/features/dimensions/dimension-edit.js");

    const out = {};

    model.objects.length = 0;
    model.history.past.length = 0;

    S.addObject(
      model,
      S.geometryFactories.line({ x: 0, y: 0 }, { x: 100, y: 0 }),
    );
    const line = model.objects[model.objects.length - 1];

    /*
     * A dimension over the line's two ENDS - the shape the inference produces
     * for a length - so `applyDimensionValue` has real references to drive.
     */
    const ref = (anchor) => ({ kind: "line", featureId: line.id, anchor });

    const dim = dimModel.createDimension(ref("start"), ref("end"), {
      x: 50,
      y: -12,
    });

    S.addObject(model, dim);

    out.created = !!dim;
    out.measuredBefore = dimModel.formatMeasurement(dim, model) || null;

    // Open the editor through the real path.
    out.opened = tool.openDimensionValuePrompt(dim) === true;

    const lengthBefore = line.geometry.end.x;

    const input = document.querySelector("[data-load-input]");
    out.inputFound = !!input;

    if (input) {
      input.value = "250";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }

    await new Promise((r) => setTimeout(r, 150));

    out.previewEndX = line.geometry.end.x;
    out.previewMovedGeometry =
      Math.abs(line.geometry.end.x - lengthBefore) > 1e-6;
    out.measuredDuringPreview = dimModel.formatMeasurement(dim, model) || null;

    // Escape -> the preview must come back off.
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );

    await new Promise((r) => setTimeout(r, 150));

    out.restoredEndX = line.geometry.end.x;
    out.cancelRestored = Math.abs(line.geometry.end.x - lengthBefore) < 1e-6;
    out.historyAfterCancel = model.history.past.length;
    out.popupClosed = !document.querySelector("[data-load-input]");

    void edit;

    return out;
  });
}

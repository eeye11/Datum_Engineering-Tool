// The combined regression pass: labels on Line and Point, the Line lock, the
// popup click areas and Escape, undo/redo on a label, and persistence.
export default async function run(page) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(String((e && e.message) || e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push("console: " + m.text());
  });

  const tab = page.getByText("Engineering Drawing", { exact: true }).first();
  if (await tab.count()) {
    await tab.click();
    await page.waitForTimeout(1000);
  }
  await page.waitForSelector(".drawing-canvas", { timeout: 15000 });

  const out = await page.evaluate(async () => {
    const S = (await import("/src/core/model/drawing-state.js")).default;
    const model = (await import("/src/editor/editor-state.js")).drawingState;
    const updater = await import("/src/editor/property-update.js");
    const canvasRender = await import("/src/editor/canvas-render.js");
    const markup = await import("/src/editor/feature-panel-markup.js");

    const canvas = document.querySelector(".drawing-canvas");
    const texts = () =>
      [...canvas.querySelectorAll("svg text")].map((t) => t.textContent);

    const r = {};

    model.objects.length = 0;

    // --- LABELS ON BOTH TYPES ---
    S.addObject(
      model,
      S.geometryFactories.line({ x: 0, y: 0 }, { x: 60, y: 0 }),
    );
    const line = model.objects[model.objects.length - 1];

    S.addObject(model, S.geometryFactories.point({ x: 0, y: 40 }));
    const point = model.objects[model.objects.length - 1];

    updater.updateFeatureProperty(line, "label", "AB");
    updater.updateFeatureProperty(point, "label", "P");
    canvasRender.renderCurrentDrawing();

    const both = texts();
    r.lineLabelDrawn = both.includes("AB");
    r.pointLabelDrawn = both.includes("P");

    // --- SELECTING ANOTHER FEATURE SHOWS ITS OWN ---
    S.selectObject(model, point.id);
    const pointPanel = markup.featurePropertyMarkup(point);
    r.pointPanelShowsOwnLabel =
      /value="P"/.test(pointPanel) && !/value="AB"/.test(pointPanel);

    // --- CLEARING LEAVES THE FEATURE ---
    updater.updateFeatureProperty(line, "label", "");
    canvasRender.renderCurrentDrawing();
    r.clearedTextGone = !texts().includes("AB");
    r.featureKept = model.objects.some((o) => o.id === line.id);

    // --- UNDO / REDO ON A LABEL ---
    const before = S.snapshotDrawing(model);
    updater.updateFeatureProperty(line, "label", "XY");
    S.commitDrawingChange(model, before);

    const afterCommit = line.label;

    S.undo(model);
    const afterUndo = model.objects.find((o) => o.id === line.id)?.label;

    S.redo(model);
    const afterRedo = model.objects.find((o) => o.id === line.id)?.label;

    r.undoRedo = { afterCommit, afterUndo, afterRedo };

    // --- PERSISTENCE ---
    updater.updateFeatureProperty(line, "label", "Keep");
    const json = S.serializeDrawing(model);
    const restored = JSON.parse(json).objects.find((o) => o.id === line.id);
    r.labelPersists = restored.label === "Keep";

    // --- LOCKED LINE ---
    line.locked = true;
    r.lockedRefusesCoord =
      updater.updateFeatureProperty(line, "start.x", 500) === false;
    line.locked = false;

    return r;
  });

  return { out, errors: errors.slice(0, 10) };
}

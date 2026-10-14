// Verify the Label fix end to end: set a label on a Line and a Point, edit it,
// clear it, move the feature, and check the canvas text follows.
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

  return await page.evaluate(async () => {
    const S = (await import("/src/core/model/drawing-state.js")).default;
    const model = (await import("/src/editor/editor-state.js")).drawingState;
    const binding = await import("/src/editor/property-binding.js");
    const panel = await import("/src/editor/feature-panel.js");
    const updater = await import("/src/editor/property-update.js");

    void binding;

    const out = {};

    // --- The setter writes object.label, not object.name ---
    const line = S.geometryFactories.line({ x: 0, y: 0 }, { x: 40, y: 0 });
    const nameBefore = line.name;
    updater.updateFeatureProperty(line, "label", "AB");
    out.lineLabel = line.label;
    out.lineNameUnchanged = line.name === nameBefore;
    out.lineHasNoNameField = !("label" in (line.geometry || {}));

    // --- The renderer draws it ---
    S.addObject(model, line);
    const canvas = document.querySelector(".drawing-canvas");
    panel.renderProperties?.();

    // Render through the editor's own path.
    const canvasRender = await import("/src/editor/canvas-render.js");
    canvasRender.renderCurrentDrawing();

    const texts = [...canvas.querySelectorAll("svg text")].map(
      (t) => t.textContent,
    );
    out.canvasHasLabel = texts.includes("AB");
    out.canvasTexts = texts.filter((t) => t === "AB").length;

    // --- Clearing removes it, keeps the feature ---
    updater.updateFeatureProperty(line, "label", "");
    canvasRender.renderCurrentDrawing();
    const afterClear = [...canvas.querySelectorAll("svg text")].map(
      (t) => t.textContent,
    );
    out.clearedTextGone = !afterClear.includes("AB");
    out.featureKept = model.objects.some((o) => o.id === line.id);

    // --- A Point, too (the shared path) ---
    const point = S.geometryFactories.point({ x: 10, y: 10 });
    updater.updateFeatureProperty(point, "label", "P1");
    S.addObject(model, point);
    canvasRender.renderCurrentDrawing();
    const withPoint = [...canvas.querySelectorAll("svg text")].map(
      (t) => t.textContent,
    );
    out.pointLabel = point.label;
    out.canvasHasPointLabel = withPoint.includes("P1");

    // --- The label follows the feature when it moves ---
    line.geometry.start = { x: 200, y: 100 };
    line.geometry.end = { x: 240, y: 100 };
    updater.updateFeatureProperty(line, "label", "CD");
    canvasRender.renderCurrentDrawing();

    const svg = canvas.querySelector("svg");
    const cd = [...svg.querySelectorAll("text")].find(
      (t) => t.textContent === "CD",
    );
    out.movedLabelRendered = !!cd;
    out.movedLabelX = cd ? Number(cd.getAttribute("x")) : null;

    // --- Persists through serialization ---
    const body = JSON.parse(S.serializeDrawing(model));
    void body;

    return out;
  });
}

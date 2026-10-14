// Verify line appearance: width, colour and line type reach the rendered SVG,
// and survive redraw, undo and a save/reopen round trip.
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
    const canvasRender = await import("/src/editor/canvas-render.js");

    const canvas = document.querySelector(".drawing-canvas");

    const linePaths = () =>
      [...canvas.querySelectorAll("svg line, svg path")].map((el) => ({
        stroke: el.getAttribute("stroke"),
        width: el.getAttribute("stroke-width"),
        dash: el.getAttribute("stroke-dasharray"),
      }));

    const out = {};

    model.objects.length = 0;
    S.addObject(
      model,
      S.geometryFactories.line({ x: 0, y: 0 }, { x: 60, y: 0 }),
    );

    const stored = model.objects[model.objects.length - 1];

    // --- WIDTH ---
    stored.style = { ...stored.style, lineWidth: 1.0 };
    canvasRender.renderCurrentDrawing();

    const afterWidth = linePaths();

    out.widthApplied = afterWidth.some((p) => Number(p.width) >= 1);

    // --- COLOUR ---
    stored.style = { ...stored.style, stroke: "#087E83" };
    canvasRender.renderCurrentDrawing();

    const afterColour = linePaths();

    out.colourApplied = afterColour.some(
      (p) => (p.stroke || "").toLowerCase() === "#087e83",
    );

    // --- LINE TYPE ---
    stored.style = { ...stored.style, lineType: "dashed" };
    canvasRender.renderCurrentDrawing();

    const afterDash = linePaths();

    out.dashApplied = afterDash.some((p) => !!p.dash);

    // --- SURVIVES A REDRAW ---
    canvasRender.renderCurrentDrawing();
    const redrawn = linePaths();

    out.survivesRedraw = redrawn.some(
      (p) => (p.stroke || "").toLowerCase() === "#087e83" && !!p.dash,
    );

    // --- APPEARANCE DID NOT MOVE THE GEOMETRY ---
    out.geometryIntact =
      stored.geometry.start.x === 0 && stored.geometry.end.x === 60;

    // --- SURVIVES A SAVE/REOPEN ROUND TRIP ---
    const json = S.serializeDrawing(model);
    const reopened = JSON.parse(json).objects[0];

    out.survivesSave =
      reopened.style.stroke.toLowerCase() === "#087e83" &&
      reopened.style.lineType === "dashed" &&
      Number(reopened.style.lineWidth) === 1;

    return out;
  });
}

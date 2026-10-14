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

    model.objects.length = 0;

    S.addObject(
      model,
      S.geometryFactories.line({ x: 0, y: 0 }, { x: 60, y: 0 }),
    );

    // The STORED object this time, read fresh from the array.
    const stored = model.objects[0];
    stored.label = "Keep";

    const json = S.serializeDrawing(model);
    const parsed = JSON.parse(json);

    // The documents path too, which is what a file actually carries.
    const doc = await import("/src/file/document-file.js");

    const payload = doc.default.createDocument(parsed);

    return {
      storedLabel: stored.label,
      serializedLabel: parsed.objects[0].label,
      inFile: payload.document.objects[0].label,
      keys: Object.keys(parsed.objects[0]).filter((k) =>
        ["label", "name", "type", "style", "geometry"].includes(k),
      ),
    };
  });
}

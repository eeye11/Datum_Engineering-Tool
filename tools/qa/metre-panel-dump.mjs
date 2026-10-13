/*
 * Dump the exact radius row markup for a circle reading in metres and in mm,
 * so the displayed number can be read rather than regex-guessed.
 */
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
    const panel = await import("/src/editor/feature-panel.js");
    const markup = await import("/src/editor/feature-panel-markup.js");
    const updater = await import("/src/editor/property-update.js");

    model.objects.length = 0;
    S.addObject(model, S.geometryFactories.circle({ x: 0, y: 0 }, 100));
    const circle = model.objects[0];
    S.selectObject(model, circle.id);
    panel.renderProperties();

    updater.updateFeatureProperty(circle, "lengthUnit", "m");
    updater.updateFeatureProperty(circle, "radius", 5);

    const html = markup.featurePropertyMarkup(circle);

    // Pull every input/select with its data-property and value, in order.
    const fields = [];
    const re = /<(input|select)\b[^>]*>/g;
    let m;
    while ((m = re.exec(html))) {
      const tag = m[0];
      const prop = /data-property="([^"]*)"/.exec(tag)?.[1];
      if (!prop) continue;
      const value = /value="([^"]*)"/.exec(tag)?.[1];
      const isSelect = m[1] === "select";
      let selected = null;
      if (isSelect) {
        selected = /<option[^>]*selected[^>]*>([^<]*)</.exec(html)?.[1] ?? null;
      }
      fields.push({ prop, value, selected });
    }

    return {
      radiusWorld: circle.geometry.radius,
      fields,
    };
  });
}

/*
 * Acceptance: the SELECTED UNIT decides what a bare number means.
 *
 * Driven through the real model, panel markup and setter - the same three
 * modules the UI uses - so this exercises the actual unit path rather than a
 * copy of it.
 *
 *   1. a Circle created from a radius typed as 5 with metres selected must be
 *      a 5 m radius (5000 mm on a 1 mm-per-unit sheet), and must read back 5;
 *   2. switching the display unit must not move the geometry;
 *   3. an explicit "5 mm" typed while reading metres must mean 5 mm.
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
    const quantities = (await import("/src/core/units/quantities.js")).default;

    const out = {};
    model.objects.length = 0;

    // A circle of radius 100 world units to start with.
    S.addObject(
      model,
      S.geometryFactories.circle({ x: 0, y: 0 }, 100)
    );

    const circle = model.objects[0];
    S.selectObject(model, circle.id);
    panel.renderProperties();

    // --- 1. FIVE METRES ---
    updater.updateFeatureProperty(circle, "lengthUnit", "m");
    updater.updateFeatureProperty(circle, "radius", 5);

    out.radiusWorld = circle.geometry.radius;
    out.radiusWorldIsFiveMetres = Math.abs(circle.geometry.radius - 5000) < 1e-9;

    const markupInMetres = markup.featurePropertyMarkup(circle);
    // The panel shows the radius input's value; read the first radius field.
    out.radiusField = /data-property="radius"[^>]*value="([^"]*)"/.exec(
      markupInMetres
    )?.[1];
    out.readsBackAsFive = out.radiusField === "5";

    // --- 2. SWITCH TO MM, GEOMETRY MUST NOT MOVE ---
    const worldBefore = circle.geometry.radius;
    updater.updateFeatureProperty(circle, "lengthUnit", "mm");
    out.geometryUnchangedByUnitSwitch = circle.geometry.radius === worldBefore;

    const markupInMm = markup.featurePropertyMarkup(circle);
    out.radiusFieldMm = /data-property="radius"[^>]*value="([^"]*)"/.exec(
      markupInMm
    )?.[1];
    out.readsBackAs5000mm = out.radiusFieldMm === "5000";

    // --- 3. EXPLICIT "5 mm" WHILE READING METRES ---
    updater.updateFeatureProperty(circle, "lengthUnit", "m");
    // Simulate the binding layer: it parses "5 mm" and writes the unit first.
    const parsed = quantities.readQuantity("5 mm", "length", "m");
    out.parsed = parsed;
    if (parsed?.explicit) {
      updater.updateFeatureProperty(circle, "lengthUnit", parsed.unit);
      updater.updateFeatureProperty(circle, "radius", parsed.value);
    }
    out.explicitRadiusWorld = circle.geometry.radius;
    out.explicitFiveMmIsFiveWorldUnits =
      Math.abs(circle.geometry.radius - 5) < 1e-9;

    return out;
  });
}
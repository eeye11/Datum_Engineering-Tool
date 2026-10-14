// Verify the shared geometry-unit change: the panel can read/enter coordinates in
// another length unit, and the PHYSICAL geometry does not move.
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
    const panel = await import("/src/editor/feature-panel.js");
    const markup = await import("/src/editor/feature-panel-markup.js");
    const updater = await import("/src/editor/property-update.js");

    const out = {};

    model.objects.length = 0;

    // A Point at 25.4 mm from the origin, so inches is an exact reading.
    S.addObject(model, S.geometryFactories.point({ x: 25.4, y: 0 }));

    const pt = model.objects[0];

    S.selectObject(model, pt.id);
    panel.renderProperties();

    const html = markup.featurePropertyMarkup(pt);

    // The panel must offer a unit selector for the coordinate fields.
    out.hasUnitSelect = /drawing-property-unit-select/.test(html);
    out.hasLengthUnitOption = /<option value="in"/.test(html);

    // --- READ IN INCHES ---
    const worldBefore = JSON.stringify(pt.geometry.position);

    updater.updateFeatureProperty(pt, "lengthUnit", "in");

    const readInInches = markup.featurePropertyMarkup(pt);

    out.readingInInches = /value="1"/.test(readInInches);
    out.worldUnchangedByRead =
      JSON.stringify(pt.geometry.position) === worldBefore;

    // --- ENTER A VALUE IN INCHES ---
    updater.updateFeatureProperty(pt, "position.x", 2);

    // 2 inches = 50.8 mm
    out.enteredInchesBecameMm = Math.round(pt.geometry.position.x * 100) / 100;

    // --- BACK TO MM ---
    updater.updateFeatureProperty(pt, "lengthUnit", "mm");
    const backToMm = markup.featurePropertyMarkup(pt);

    out.readsMmAgain = /value="50.8"/.test(backToMm);

    // --- THE INVALID UNIT IS REFUSED ---
    const refused = updater.updateFeatureProperty(pt, "lengthUnit", "kg");
    out.badUnitRefused = refused === false && pt.lengthUnit === undefined;

    return out;
  });
}

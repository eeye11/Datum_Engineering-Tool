/*
 * ========================================================
 * ACCEPTANCE TEST - UNIT EDITING IN THE FEATURES TAB
 * ========================================================
 *
 *   [ 5.0 ] [ kN/m  v ]   and   [ 120 ] [ N  v ]
 *
 * Changing a feature's unit from its own panel must RELABEL the value, not
 * rescale it: 1 kN and 1000 N are the same force. The stored number is what
 * stays, and the drawing's own label follows the unit that was chosen - so the
 * panel and the sheet cannot disagree.
 */

export default async function run(page) {
  const out = { steps: [] };
  const log = (name, value) => out.steps.push({ name, value });

  /*
   * Force the entry point to finish before driving the app.
   *
   * The page loads main.js as a deferred module, and on a cold dev server that
   * can still be pending when a probe starts. Importing it here is idempotent -
   * a module evaluates once - so this either waits for it or does nothing.
   */
  await page.evaluate(async () => {
    await import("/src/main.js");
  });

  await page.waitForFunction(
    () =>
      typeof window.enggDrawing === "object" &&
      window.enggDrawing.state &&
      typeof window.enggLoadProfile === "object",
    null,
    { timeout: 60000 },
  );

  await page.waitForTimeout(500);

  /* A point force and a moment, with known magnitudes. */
  const built = await page.evaluate(() => {
    const ds = window.enggDrawingState;
    const st = window.enggDrawing.state;
    const F = ds.geometryFactories;

    const before = ds.snapshotDrawing(st);
    st.objects = [];

    const force = F.force(
      { x: 0, y: 0 },
      { x: 0, y: -100 },
      { style: {} },
    );
    force.id = "force_u";
    force.name = "Point Force 1";
    force.geometry.magnitude = 250;
    st.objects.push(force);

    const moment = F.moment(
      { x: 200, y: 0 },
      { style: {} },
    );
    moment.id = "moment_u";
    moment.name = "Moment 1";
    moment.geometry.magnitude = 40;
    st.objects.push(moment);

    ds.commitDrawingChange(st, before);

    return {
      forceMagnitude: force.geometry.magnitude,
      forceUnit: window.enggLoadProfile.forceUnit(force.geometry),
      momentMagnitude: moment.geometry.magnitude,
      momentUnit: window.enggLoadProfile.momentUnit(moment.geometry),
    };
  });

  log("built", built);

  /* Change the FORCE's unit through the shared setter. */
  const forceUnitChanged = await page.evaluate(() => {
    const st = window.enggDrawing.state;
    const object = st.objects.find((o) => o.id === "force_u");

    const beforeMagnitude = object.geometry.magnitude;

    window.enggLoadProfile.setForceUnit(object.geometry, "kN");

    return {
      unit: window.enggLoadProfile.forceUnit(object.geometry),
      magnitudeUnchanged: object.geometry.magnitude === beforeMagnitude,
      magnitude: object.geometry.magnitude,
    };
  });

  log("forceUnitChanged", forceUnitChanged);

  /* Change the MOMENT's unit. */
  const momentUnitChanged = await page.evaluate(() => {
    const st = window.enggDrawing.state;
    const object = st.objects.find((o) => o.id === "moment_u");

    const beforeMagnitude = object.geometry.magnitude;

    window.enggLoadProfile.setMomentUnit(object.geometry, "kN\u00b7m");

    return {
      unit: window.enggLoadProfile.momentUnit(object.geometry),
      magnitudeUnchanged: object.geometry.magnitude === beforeMagnitude,
      magnitude: object.geometry.magnitude,
    };
  });

  log("momentUnitChanged", momentUnitChanged);

  /* The DRAWING's own label must follow the chosen unit. */
  const annotationFollows = await page.evaluate(() => {
    const st = window.enggDrawing.state;
    const am = window.enggDrawingState.annotationModel;

    const force = st.objects.find((o) => o.id === "force_u");
    const moment = st.objects.find((o) => o.id === "moment_u");

    return {
      forceText: am.textFor
        ? am.textFor({ kind: "force-value", sourceFeatureId: force.id }, st)
        : null,
      momentText: am.textFor
        ? am.textFor({ kind: "moment-value", sourceFeatureId: moment.id }, st)
        : null,
    };
  });

  log("annotationFollows", annotationFollows);

  /* The unit survives a save/open round trip. */
  const persists = await page.evaluate(() => {
    const body = window.enggDrawingSheets.serializeDocumentBody();
    const read = window.enggDocumentFile.readDocument(
      window.enggDocumentFile.createDocument(body),
    );

    const objects = (read.document?.sheets || [])
      .flatMap((sheet) => sheet.objects || []);

    const force = objects.find((o) => o.id === "force_u");
    const moment = objects.find((o) => o.id === "moment_u");

    return {
      readOk: read.ok,
      forceUnit: force && force.geometry && force.geometry.unit,
      momentUnit: moment && moment.geometry && moment.geometry.momentUnit,
    };
  });

  log("persists", persists);

  return out;
}
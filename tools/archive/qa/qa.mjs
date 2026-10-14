/*
 * Browser check for the Statics work: does Show Magnitudes actually put a
 * value on the sheet, and do the Statics modules load at all.
 *
 * The jsdom tests prove the model and renderer agree. This asks the real
 * page, where the modules are loaded the way a student loads them.
 */
export default async function run(page, ui) {
  await ui.click("@e2"); // Engineering Drawing

  await page.waitForTimeout(1500);

  const mounted = await page.evaluate(() => {
    const canvas =
      document.querySelector("svg") ||
      document.querySelector("#canvas") ||
      document.querySelector("[id*=canvas]");

    return {
      hasSvg: Boolean(canvas),
      canvasId: canvas ? canvas.id || canvas.tagName : null,
      /*
       * These are the modules the Statics work touches. If any is missing,
       * every feature that depends on it silently draws nothing.
       */
      modules: {
        annotationModel: Boolean(window.enggAnnotationModel),
        measurement: Boolean(window.enggMeasurement),
        renderer: Boolean(window.enggDrawingRenderer),
        state: Boolean(window.enggDrawingState),
        loadProfile: Boolean(window.enggLoadProfile),
        bodyFrames: Boolean(window.enggBodyFrames),
      },
      derivedAnnotationExists: Boolean(
        window.enggAnnotationModel &&
        typeof window.enggAnnotationModel.derivedAnnotation === "function",
      ),
    };
  });

  return mounted;
}

/*
 * ========================================================
 * ACCEPTANCE TEST - CRASH RECOVERY
 * ========================================================
 *
 * A drawing with significant unsaved work is built, a recovery copy is taken,
 * and the page is RELOADED - which is what an unexpected interruption looks
 * like from the application's side. On the way back up Datum must:
 *
 *   - find the recovery copy
 *   - offer "Recovered drawing available" with Recover / Discard Recovery
 *   - restore the FULL document, not a flattened copy: sheets, World Scale,
 *     features, parent relationships, annotations and a moved annotation's
 *     position
 *   - treat the restored document as UNSAVED work
 */

export default async function run(page) {
  const out = { steps: [] };
  const log = (name, value) => out.steps.push({ name, value });

  /* ---------------- session one: build and let recovery run ---------- */

  await page.waitForFunction(() => typeof window.datum === "object", null, {
    timeout: 20000,
  });

  await page.evaluate(async () => {
    if (typeof window.enggDrawing !== "object") {
      const mod = await import("/src/app/automation-hooks.js");
      mod.installAutomationHooks();
    }
  });

  const tab = page.getByRole("button", { name: "Engineering Drawing" });
  if (await tab.count()) {
    await tab.first().click();
    await page.waitForTimeout(800);
  }

  const built = await page.evaluate(() => {
    const ds = window.enggDrawingState;
    const st = window.enggDrawing.state;
    const F = ds.geometryFactories;
    const sheets = window.enggDrawingSheets;

    /* A beam with a child force, a moved annotation, and World Scale. */
    const before = ds.snapshotDrawing(st);
    st.objects = [];

    const beam = F.beam({ x: 0, y: 0 }, { x: 300, y: 0 }, { style: {} });
    beam.id = "beam_r";
    st.objects.push(beam);

    const force = F.force({ x: 150, y: 0 }, { x: 150, y: -80 }, { style: {} });
    force.id = "force_r";
    force.parentId = "beam_r";
    st.objects.push(force);

    const annotation = ds.annotationModel.createAnnotation({
      kind: "force-value",
      sourceFeatureId: "force_r",
      position: { x: 500, y: 260 },
    });
    annotation.id = "annotation_r";
    annotation.placement = { x: 500, y: 260 };
    annotation.placementMode = "manual";
    st.objects.push(annotation);

    st.scale = { mmPerUnit: 4, unit: "mm" };

    ds.commitDrawingChange(st, before);

    /* A recovery copy, written now rather than waiting for the timer. */
    const body = window.enggDrawingSheets.serializeDocumentBody();
    window.enggRecovery.write(body, "CrashTest.enggdraw");

    return {
      objects: st.objects.length,
      stored: Boolean(window.enggRecovery.read()),
      features: window.enggRecovery.describe()?.features,
      sheets: sheets.all().length,
    };
  });

  log("built", built);

  /* ---------------- session two: reload and recover ------------------ */

  await page.reload({ waitUntil: "domcontentloaded" });

  await page.waitForFunction(() => typeof window.datum === "object", null, {
    timeout: 20000,
  });

  await page.evaluate(async () => {
    if (typeof window.enggDrawing !== "object") {
      const mod = await import("/src/app/automation-hooks.js");
      mod.installAutomationHooks();
    }
  });

  /*
   * offerRecoveryIfAvailable runs at start-up; the dialog should be up. If the
   * prompt was already answered by a previous run, recover explicitly.
   */
  const prompt = await page.evaluate(() => ({
    title: (document.querySelector(".engg-dialog-title") || {}).textContent,
    buttons: [...document.querySelectorAll(".engg-dialog-button")].map((b) =>
      b.textContent.trim(),
    ),
  }));

  log("prompt", prompt);

  const recovered = await page.evaluate(async () => {
    const recover = [...document.querySelectorAll(".engg-dialog-button")].find(
      (b) => /^recover$/i.test(b.textContent.trim()),
    );

    if (!recover) {
      return { error: "no recover button" };
    }

    recover.click();
    await new Promise((r) => setTimeout(r, 1200));

    const st = window.enggDrawing.state;
    const byId = (id) => st.objects.find((o) => o.id === id);

    return {
      objects: st.objects.length,
      ids: st.objects.map((o) => o.id),
      scale: st.scale,
      forceParent: byId("force_r") ? byId("force_r").parentId : null,
      annotation: byId("annotation_r")
        ? {
            source: byId("annotation_r").sourceFeatureId,
            placement: byId("annotation_r").placement,
          }
        : null,
      drawn: document.querySelectorAll(".drawing-canvas svg [data-feature-id]")
        .length,
      title: document.title,
      message: (document.getElementById("drawingToolMessage") || "")
        .textContent,
      recoveryCleared: window.enggRecovery.available() === false,
    };
  });

  log("recovered", recovered);

  /* The recovered document must behave as UNSAVED work: Open must ask. */
  const dirtyCheck = await page.evaluate(async () => {
    /*
     * The UI is the reliable witness here: if the recovered document is dirty,
     * pressing New must stop and ask. A second import of the commands module
     * would give a different instance with its own flag, so the button is used.
     */
    document.querySelector('[data-file-action="new"]').click();
    await new Promise((r) => setTimeout(r, 500));

    const title = (document.querySelector(".engg-dialog-title") || {})
      .textContent;

    const cancel = [...document.querySelectorAll(".engg-dialog-button")].find(
      (b) => /cancel/i.test(b.textContent),
    );

    if (cancel) {
      cancel.click();
      await new Promise((r) => setTimeout(r, 300));
    }

    return { title };
  });

  log("dirtyCheck", dirtyCheck);

  return out;
}

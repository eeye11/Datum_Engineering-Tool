/*
 * ========================================================
 * ROUND-TRIP: A REALISTIC ENGINEERING DOCUMENT
 * ========================================================
 *
 * Saves a document that exercises the whole model - bodies, a child force with
 * a parent relationship, World Scale, a dimension, a manually moved annotation,
 * and a second sheet - then opens it again and checks that EVERY part comes
 * back: the same ids, the same parent links, the same calibration, the same
 * sheet list and active sheet, and that the restored features are registered in
 * the live drawing state and drawn on the canvas.
 *
 * Then it RESAVES the opened document and opens that again, which is the check
 * that opening and saving again does not corrupt the file.
 */

export default async function run(page) {
  const out = {};

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
    await page.waitForTimeout(900);
  }

  /* ---------------------------------------------------------------- */
  /* Build the document directly in the live state, then save it.       */
  /* ---------------------------------------------------------------- */

  out.built = await page.evaluate(() => {
    const ds = window.enggDrawingState;
    const st = window.enggDrawing.state;
    const F = ds.geometryFactories;
    const sheets = window.enggDrawingSheets;
    const am = ds.annotationModel;

    /* A blank first sheet, calibrated, with a beam and its children. */
    const beam = F.beam({ x: 0, y: 0 }, { x: 300, y: 0 }, { style: {} });
    beam.id = "beam_17";
    beam.name = "Beam 1";

    st.objects.push(beam);

    /* A point force attached to the beam by id. */
    const force = F.force(
      { x: 150, y: 0 },
      { x: 150, y: -80 },
      { style: {} },
    );
    force.id = "force_9";
    force.name = "Point Force 1";
    force.parentId = "beam_17";
    st.objects.push(force);

    /* A manually placed annotation about that force. */
    const annotation = am.createAnnotation({
      kind: "force-value",
      sourceFeatureId: "force_9",
      position: { x: 420, y: 210 },
    });
    annotation.id = "annotation_5";
    annotation.placement = { x: 420, y: 210 };
    annotation.placementMode = "manual";
    st.objects.push(annotation);

    /* Calibrate the sheet, so World Scale is part of the saved document. */
    st.scale = { mmPerUnit: 2.5, unit: "mm" };

    /* A second sheet, with one feature, to check the sheet list. */
    const second = sheets.createSheet({
      name: "Free Body Diagram",
      content: {
        objects: [
          (() => {
            const l = F.line({ x: 0, y: 0 }, { x: 50, y: 50 }, { style: {} });
            l.id = "line_second";
            return l;
          })(),
        ],
        scale: { mmPerUnit: 10, unit: "mm" },
      },
    });

    /* Go back to the first sheet so it is the ACTIVE one which is saved. */
    sheets.activateSheet(sheets.all()[0].id);

    return {
      activeId: sheets.activeSheetId(),
      sheets: sheets.all().map((s) => ({
        id: s.id,
        name: s.name,
        objects: s.objects.length,
      })),
    };
  });

  /* Serialise exactly as Save does, and wrap it as the file format does. */
  out.saved = await page.evaluate(() => {
    const body = window.enggDrawingSheets.serializeDocumentBody();
    const payload = window.enggDocumentFile.createDocument(body);
    window.__qaFile = JSON.stringify(payload);

    return {
      sheets: (body.sheets || []).length,
      activeSheetId: body.activeSheetId,
      title: document.title,
    };
  });

  /*
   * Return to a CLEAN empty document via the application's own New command.
   * Driving it through the UI (rather than a second module instance obtained
   * by import) is what guarantees the probe is looking at the SAME dirty flag
   * the Open command will look at.
   */
  out.reset = await page.evaluate(async () => {
    document.querySelector('[data-file-action="new"]').click();
    await new Promise((r) => setTimeout(r, 350));

    const title = (document.querySelector(".engg-dialog-title") || {})
      .textContent;

    const discard = [...document.querySelectorAll(".engg-dialog-button")].find(
      (b) => /discard/i.test(b.textContent),
    );

    if (discard) {
      discard.click();
      await new Promise((r) => setTimeout(r, 400));
    }

    return {
      dialogTitle: title || null,
      usedDiscard: Boolean(discard),
      dialogStillOpen: Boolean(document.querySelector(".engg-dialog-backdrop")),
      objects: window.enggDrawing.state.objects.length,
    };
  });

  /* Drive Open through the real command, bypassing the picker. */
  out.openApplied = await page.evaluate(async () => {
    const raw = window.__qaFile;

    const realCreate = document.createElement.bind(document);
    document.createElement = (tag) => {
      const node = realCreate(tag);
      if (String(tag).toLowerCase() === "input") {
        node.click = () => {
          Object.defineProperty(node, "files", {
            value: [new File([raw], "R.enggdraw", { type: "application/json" })],
            configurable: true,
          });
          node.dispatchEvent(new Event("change"));
        };
      }
      return node;
    };

    try {
      document.querySelector('[data-file-action="open"]').click();
    } finally {
      document.createElement = realCreate;
    }

    await new Promise((r) => setTimeout(r, 900));

    const st = window.enggDrawing.state;
    const sheets = window.enggDrawingSheets;
    const byId = (id) => st.objects.find((o) => o.id === id);

    return {
      dialogOpen: Boolean(document.querySelector(".engg-dialog-backdrop")),
      dialogTitle: (document.querySelector(".engg-dialog-title") || {})
        .textContent,
      dialogButtons: [...document.querySelectorAll(".engg-dialog-button")].map(
        (b) => b.textContent.trim(),
      ),
      message: (document.getElementById("drawingToolMessage") || {})
        .textContent,
      objects: st.objects.length,
      drawn: document.querySelectorAll(
        ".drawing-canvas svg [data-feature-id]",
      ).length,
      scale: st.scale,
      beamParentless: Boolean(byId("beam_17")) && !byId("beam_17").parentId,
      forceParent: byId("force_9") ? byId("force_9").parentId : null,
      annotation: byId("annotation_5")
        ? {
            source: byId("annotation_5").sourceFeatureId,
            placement: byId("annotation_5").placement,
            mode: byId("annotation_5").placementMode,
          }
        : null,
      sheets: sheets.all().map((s) => ({
        id: s.id,
        name: s.name,
        objects: s.objects.length,
        scale: s.scale,
      })),
      activeName: (sheets.activeSheet() || {}).name,
      title: document.title,
    };
  });

  /* ---------------------------------------------------------------- */
  /* The opened document must be editable: select a restored feature.   */
  /* ---------------------------------------------------------------- */

  out.select = await page.evaluate(() => {
    const ds = window.enggDrawingState;
    const st = window.enggDrawing.state;

    ds.selectObject(st, "force_9");

    return {
      selected: st.selection.selectedObjectIds,
      panelText: (document.querySelector("#drawingProperties") || {}).innerText
        ? document.querySelector("#drawingProperties").innerText.slice(0, 80)
        : "",
    };
  });

  /* ---------------------------------------------------------------- */
  /* Fit must work IMMEDIATELY on the opened drawing, with no prior     */
  /* interaction: it measures features that are really registered.      */
  /* ---------------------------------------------------------------- */

  out.fit = await page.evaluate(async () => {
    const st = window.enggDrawing.state;

    /* Deselect, so Fit measures the WHOLE sheet rather than a selection. */
    st.selection.selectedObjectIds = [];

    const before = { ...st.camera };

    const fitButton = document.querySelector('[data-global-tool="fit"]');
    if (!fitButton) {
      return { error: "no fit button" };
    }

    fitButton.click();
    await new Promise((r) => setTimeout(r, 400));

    return {
      before,
      after: { ...st.camera },
      changed: before.zoom !== st.camera.zoom,
    };
  });

  /* ---------------------------------------------------------------- */
  /* Resave the opened document and open THAT - it must stay valid.     */
  /* ---------------------------------------------------------------- */

  out.resaved = await page.evaluate(() => {
    const ds = window.enggDrawingState;
    const st = window.enggDrawing.state;
    const F = ds.geometryFactories;

    /* A real edit, committed so the document becomes dirty again. */
    const before = ds.snapshotDrawing(st);
    ds.addObject(st, F.circle({ x: 700, y: 700 }, 20, { style: {} }));
    ds.commitDrawingChange(st, before);

    const body = window.enggDrawingSheets.serializeDocumentBody();
    const read = window.enggDocumentFile.readDocument(
      window.enggDocumentFile.createDocument(body),
    );

    return {
      readOk: read.ok,
      failure: read.failure || null,
      sheets: (read.document?.sheets || []).length,
      activeObjects: (read.document?.sheets || []).find(
        (s) => s.id === read.document.activeSheetId,
      )?.objects.length,
    };
  });

  return out;
}

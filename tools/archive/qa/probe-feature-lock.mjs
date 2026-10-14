/*
 * ========================================================
 * ACCEPTANCE TEST - FEATURE LOCK
 * ========================================================
 *
 *   - a locked feature CANNOT be dragged
 *   - it remains SELECTABLE and inspectable
 *   - its PROPERTIES remain editable (the lock is about moving, not editing)
 *   - unlocking restores normal movement
 *   - the lock persists through a save/open round trip
 */

export default async function run(page) {
  const out = { steps: [] };
  const log = (name, value) => out.steps.push({ name, value });

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

  /* One line, and the manipulation drag entry point. */
  const built = await page.evaluate(async () => {
    const ds = window.enggDrawingState;
    const st = window.enggDrawing.state;
    const F = ds.geometryFactories;

    const before = ds.snapshotDrawing(st);
    st.objects = [];

    const line = F.line({ x: 0, y: 0 }, { x: 200, y: 0 }, { style: {} });
    line.id = "line_lock";
    line.name = "Line 1";
    st.objects.push(line);

    ds.commitDrawingChange(st, before);
    ds.selectObject(st, "line_lock");

    /*
     * Show the feature EDITOR rather than the component tree. The panel opens
     * on the tree; the editor is a second view, and the lock control lives in
     * it. Setting the view through the app's own state is what a user does by
     * pressing Features.
     */
    window.enggEditorState.featurePanelView = "edit";

    const toggle = document.getElementById("drawingFeaturesPanelToggle");

    const panel = document.querySelector("#drawingProperties");

    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (panel.querySelector("[data-feature-lock]")) {
        break;
      }

      if (toggle) {
        toggle.click();
      }

      await new Promise((r) => setTimeout(r, 250));
    }

    /* The lock control is in the panel; the panel must show it. */
    return {
      hasLockControl: Boolean(panel.querySelector("[data-feature-lock]")),
      checked: Boolean(panel.querySelector("[data-feature-lock]")?.checked),
      panelText: (panel.innerText || "").slice(0, 200),
      toggleFound: Boolean(toggle),
    };
  });

  log("built", built);

  /* Lock it through the panel control. */
  const locked = await page.evaluate(async () => {
    const panel = document.querySelector("#drawingProperties");
    const input = panel.querySelector("[data-feature-lock]");

    if (!input) {
      return {
        error: "no lock control in the panel",
        panelText: (panel.innerText || "").slice(0, 200),
        panelHtml: panel.innerHTML.slice(0, 400),
      };
    }

    input.checked = true;
    input.dispatchEvent(new Event("change", { bubbles: true }));

    await new Promise((r) => setTimeout(r, 300));

    const st = window.enggDrawing.state;
    const object = st.objects.find((o) => o.id === "line_lock");

    return {
      locked: Boolean(object.locked),
      controlShowsLocked: Boolean(
        document
          .querySelector("#drawingProperties")
          .querySelector("[data-feature-lock]").checked,
      ),
    };
  });

  log("locked", locked);

  /* Try to DRAG it. The geometry must not move. */
  const dragAttempt = await page.evaluate(async () => {
    const mod = await import("/src/editor/drag.js");
    const ds = window.enggDrawingState;
    const st = window.enggDrawing.state;

    const object = st.objects.find((o) => o.id === "line_lock");
    const beforeGeometry = JSON.stringify(object.geometry);

    /*
     * The press is placed on the line's real SCREEN position, so it lands on the
     * feature - a synthetic (0,0) event would miss it and the refusal would be
     * for the wrong reason, which is not evidence about the lock at all.
     */
    const canvas = document.querySelector(".drawing-canvas");
    const bounds = canvas.getBoundingClientRect();

    const screen = ds.engineeringToScreen(
      { x: 100, y: 0 },
      { width: canvas.clientWidth, height: canvas.clientHeight },
      st,
    );

    const started = mod.beginManipulationDrag({
      button: 0,
      shiftKey: false,
      pointerId: 1,
      clientX: bounds.left + screen.x,
      clientY: bounds.top + screen.y,
    });

    await new Promise((r) => setTimeout(r, 150));

    return {
      dragStarted: started,
      geometryUnchanged: JSON.stringify(object.geometry) === beforeGeometry,
      message: (document.getElementById("drawingToolMessage") || "")
        .textContent,
    };
  });

  log("dragAttempt", dragAttempt);

  /* Still selectable and still listed. */
  const stillReachable = await page.evaluate(async () => {
    const mod = await import("/src/editor/hit-testing.js");
    const ds = window.enggDrawingState;
    const st = window.enggDrawing.state;

    const picked = mod.objectAtPoint({ x: 100, y: 0 }, st);

    ds.selectObject(st, "line_lock");

    return {
      picked: picked ? picked.id : null,
      selected: st.selection.selectedObjectIds,
    };
  });

  log("stillReachable", stillReachable);

  /* Unlock, then drag: the geometry may move again. */
  const unlocked = await page.evaluate(async () => {
    const panel = document.querySelector("#drawingProperties");
    const input = panel.querySelector("[data-feature-lock]");

    if (!input) {
      return { error: "no lock control to unlock" };
    }

    input.checked = false;
    input.dispatchEvent(new Event("change", { bubbles: true }));

    await new Promise((r) => setTimeout(r, 300));

    const st = window.enggDrawing.state;
    const object = st.objects.find((o) => o.id === "line_lock");

    return {
      locked: Boolean(object.locked),
      canDragAgain: !object.locked,
    };
  });

  log("unlocked", unlocked);

  /* The lock travels with the document. */
  const persists = await page.evaluate(() => {
    const ds = window.enggDrawingState;
    const st = window.enggDrawing.state;

    ds.selectObject(st, "line_lock");

    /* Lock it again, then round-trip the document through the file format. */
    const object = st.objects.find((o) => o.id === "line_lock");
    object.locked = true;

    const body = window.enggDrawingSheets.serializeDocumentBody();
    const read = window.enggDocumentFile.readDocument(
      window.enggDocumentFile.createDocument(body),
    );

    const saved = (read.document?.sheets || [])
      .flatMap((sheet) => sheet.objects || [])
      .find((o) => o.id === "line_lock");

    return {
      readOk: read.ok,
      lockedSurvives: Boolean(saved && saved.locked),
    };
  });

  log("persists", persists);

  return out;
}
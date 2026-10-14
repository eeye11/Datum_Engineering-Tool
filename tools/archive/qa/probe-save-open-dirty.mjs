/*
 * SAVE -> OPEN DIRTY-STATE PROBE
 *
 * Reproduces the exact workflows the fix must satisfy, driving the real UI:
 *
 *   1. Create a drawing, Save As A.enggdraw.
 *   2. Open another file.
 *   3. Assert no Unsaved Changes dialog appears (the document was saved).
 *
 * And it checks that an opened file's features land in the live drawing state
 * and are drawn on the canvas.
 *
 * The native save/open pickers are stubbed at their real integration points
 * (window.showSaveFilePicker, the <input type="file"> element the Open command
 * creates), so what is exercised is everything the application does around them.
 */

export default async function run(page) {
  const out = { steps: [] };
  const log = (name, value) => out.steps.push({ name, value });

  /* Wait for the app's own entry point to finish wiring the editor. */
  await page.waitForFunction(() => typeof window.datum === "object", null, {
    timeout: 20000,
  });

  /*
   * Ensure the internal automation handles exist. They are the same objects the
   * application uses; installing them is idempotent and only affects the test
   * page's global scope.
   */
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

  await page.waitForFunction(
    () => window.enggDrawing && window.enggDrawing.state,
    null,
    { timeout: 15000 },
  );

  /*
   * A native save that succeeds and remembers a handle, plus a native file
   * picker that returns a chosen file. Both are the real browser APIs the app
   * calls, stubbed so the test can decide the outcome.
   */
  await page.evaluate(() => {
    window.__qa = { saved: [], opened: [], dialogs: [] };

    let handleName = null;

    window.showSaveFilePicker = async (options) => {
      handleName = options.suggestedName || "drawing.enggdraw";
      window.__qa.saved.push(handleName);

      return {
        name: handleName,
        createWritable: async () => ({
          write: async () => {},
          close: async () => {},
        }),
      };
    };

    /* Record any EnggDraw dialog that opens. */
    const observer = new MutationObserver(() => {
      const dialog = document.querySelector(".engg-dialog-title");
      if (
        dialog &&
        dialog.textContent.trim() &&
        !window.__qa.dialogs.includes(dialog.textContent.trim())
      ) {
        window.__qa.dialogs.push(dialog.textContent.trim());
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    window.__qa.lastDialog = () =>
      (document.querySelector(".engg-dialog-title") || {}).textContent || null;
  });

  /* ---------------------------------------------------------------- */
  /* 1. Draw something and save it.                                     */
  /* ---------------------------------------------------------------- */

  const draw = await page.evaluate(() => {
    const ds = window.enggDrawingState;
    const st = window.enggDrawing.state;
    const F = ds.geometryFactories;

    const before = ds.snapshotDrawing(st);

    ds.addObject(
      st,
      F.line({ x: 0, y: 0 }, { x: 160, y: 0 }, { style: {} }),
    );

    /* Commit exactly as a drawn feature does, so the document goes dirty. */
    ds.commitDrawingChange(st, before);

    return {
      objects: st.objects.length,
      sheetObjects: window.enggDrawingSheets.all()[0].objects.length,
    };
  });

  log("drawn", draw);

  await page.getByRole("button", { name: "Save As" }).click();
  await page.waitForTimeout(600);

  const afterSaveAs = await page.evaluate(() => ({
    saved: window.__qa.saved,
    dialogs: window.__qa.dialogs.slice(),
    message: (document.getElementById("drawingToolMessage") || {})
      .textContent,
  }));

  log("afterSaveAs", afterSaveAs);

  /* ---------------------------------------------------------------- */
  /* 2. Save (now writes back to the remembered handle).                */
  /* ---------------------------------------------------------------- */

  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.waitForTimeout(500);

  const afterSave = await page.evaluate(() => ({
    saved: window.__qa.saved,
    dialogs: window.__qa.dialogs.slice(),
    message: (document.getElementById("drawingToolMessage") || {})
      .textContent,
  }));

  log("afterSave", afterSave);

  /* ---------------------------------------------------------------- */
  /* 3. A second drawing in a second file, then Open it while the first */
  /*    is saved and clean. NO dialog should appear.                    */
  /* ---------------------------------------------------------------- */

  const secondFile = await page.evaluate(async () => {
    /*
     * Build a second document body directly from the model and wrap it the way
     * a real .enggdraw file is wrapped, so Open has a genuine file to read.
     */
    const F = window.enggDrawingState.geometryFactories;

    const payload = window.enggDrawingSheets.serializeDocumentBody();

    const cell = F.circle({ x: 400, y: 120 }, 40, { style: {} });
    payload.sheets[0].objects.push(JSON.parse(JSON.stringify(cell)));

    const doc = window.enggDocumentFile.createDocument(payload);

    return JSON.stringify(doc);
  });

  /*
   * A reusable Open driver: intercepts the <input type="file"> the Open command
   * creates, seeds it with a real File and fires the change event, so the whole
   * Open pipeline runs without an operating-system dialog.
   */
  await page.evaluate(() => {
    window.__qa.openWith = async (text, name) => {
      const file = new File([text], name || "B.enggdraw", {
        type: "application/vnd.enggdraw+json",
      });

      const realCreate = document.createElement.bind(document);

      document.createElement = (tag) => {
        const node = realCreate(tag);
        if (String(tag).toLowerCase() === "input") {
          node.click = () => {
            Object.defineProperty(node, "files", {
              value: [file],
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

      await new Promise((r) => setTimeout(r, 700));
    };
  });

  /* ---------------------------------------------------------------- */
  /* 3a. Modify the drawing so it is dirty, then Open. The dialog MUST  */
  /*     appear, offering the three explicit choices.                   */
  /* ---------------------------------------------------------------- */

  const dirtyThenOpen = await page.evaluate(async (text) => {
    const ds = window.enggDrawingState;
    const st = window.enggDrawing.state;
    const F = ds.geometryFactories;

    const before = ds.snapshotDrawing(st);
    ds.addObject(st, F.line({ x: 0, y: 40 }, { x: 80, y: 40 }, { style: {} }));
    ds.commitDrawingChange(st, before);

    await window.__qa.openWith(text, "B.enggdraw");

    const buttons = [...document.querySelectorAll(".engg-dialog-button")].map(
      (b) => b.textContent.trim(),
    );

    return {
      dialogTitle: (document.querySelector(".engg-dialog-title") || {})
        .textContent,
      buttons,
      objectsStillCurrent: st.objects.length,
      message: (document.getElementById("drawingToolMessage") || {})
        .textContent,
    };
  }, secondFile);

  log("dirtyThenOpen", dirtyThenOpen);

  /*
   * Choose Discard Changes. That must NOT delete any file - it must throw away
   * the unsaved edits and continue with the Open.
   */
  const afterDiscardOpen = await page.evaluate(async () => {
    const ds = window.enggDrawingState;
    const st = window.enggDrawing.state;

    const discard = [...document.querySelectorAll(".engg-dialog-button")].find(
      (b) => /discard/i.test(b.textContent),
    );

    if (!discard) {
      return { error: "no discard button" };
    }

    discard.click();
    await new Promise((r) => setTimeout(r, 800));

    return {
      objects: st.objects.length,
      types: st.objects.map((o) => o.type),
      drawn: document.querySelectorAll(
        ".drawing-canvas svg [data-feature-id]",
      ).length,
      dialogOpen: Boolean(document.querySelector(".engg-dialog-backdrop")),
      message: (document.getElementById("drawingToolMessage") || {})
        .textContent,
    };
  });

  log("afterDiscardOpen", afterDiscardOpen);

  /* ---------------------------------------------------------------- */
  /* 3b. The opened document must be CLEAN: New must happen with no     */
  /*     dialog and no confirmation.                                    */
  /* ---------------------------------------------------------------- */

  const afterOpenNew = await page.evaluate(async () => {
    document.querySelector('[data-file-action="new"]').click();
    await new Promise((r) => setTimeout(r, 500));

    return {
      dialogOpen: Boolean(document.querySelector(".engg-dialog-backdrop")),
      dialogTitle: (document.querySelector(".engg-dialog-title") || {})
        .textContent,
      objects: window.enggDrawing.state.objects.length,
      message: (document.getElementById("drawingToolMessage") || {})
        .textContent,
    };
  });

  log("afterOpenNew", afterOpenNew);

  /* ---------------------------------------------------------------- */
  /* 4. CANCEL leaves the current drawing exactly as it was.            */
  /* ---------------------------------------------------------------- */

  const cancelOutcome = await page.evaluate(async (text) => {
    const ds = window.enggDrawingState;
    const st = window.enggDrawing.state;
    const F = ds.geometryFactories;

    const before = ds.snapshotDrawing(st);
    ds.addObject(st, F.line({ x: 0, y: 0 }, { x: 60, y: 0 }, { style: {} }));
    ds.commitDrawingChange(st, before);

    const objectsBefore = st.objects.length;

    await window.__qa.openWith(text, "B.enggdraw");

    const cancel = [...document.querySelectorAll(".engg-dialog-button")].find(
      (b) => /cancel/i.test(b.textContent),
    );

    cancel.click();
    await new Promise((r) => setTimeout(r, 600));

    return {
      objectsBefore,
      objectsAfter: st.objects.length,
      dialogOpen: Boolean(document.querySelector(".engg-dialog-backdrop")),
    };
  }, secondFile);

  log("cancelOutcome", cancelOutcome);

  /* ---------------------------------------------------------------- */
  /* 5. SAVE FIRST writes the current file and THEN opens the other.    */
  /* ---------------------------------------------------------------- */

  const saveFirstOutcome = await page.evaluate(async (text) => {
    const ds = window.enggDrawingState;
    const st = window.enggDrawing.state;
    const F = ds.geometryFactories;

    const before = ds.snapshotDrawing(st);
    ds.addObject(st, F.line({ x: 0, y: 90 }, { x: 90, y: 90 }, { style: {} }));
    ds.commitDrawingChange(st, before);

    const writesBefore = window.__qa.saved.length;

    await window.__qa.openWith(text, "B.enggdraw");

    const save = [...document.querySelectorAll(".engg-dialog-button")].find(
      (b) => /save first/i.test(b.textContent),
    );

    if (!save) {
      return { error: "no save-first button" };
    }

    save.click();

    /* The native save is asynchronous; give it time, then let Open run. */
    await new Promise((r) => setTimeout(r, 1200));

    return {
      writesBefore,
      writesAfter: window.__qa.saved.length,
      objects: st.objects.length,
      types: st.objects.map((o) => o.type),
      drawn: document.querySelectorAll(
        ".drawing-canvas svg [data-feature-id]",
      ).length,
      dialogOpen: Boolean(document.querySelector(".engg-dialog-backdrop")),
      message: (document.getElementById("drawingToolMessage") || {})
        .textContent,
    };
  }, secondFile);

  log("saveFirstOutcome", saveFirstOutcome);

  /* ---------------------------------------------------------------- */
  /* 6. Cancelling the SAVE-AS picker changes nothing.                  */
  /* ---------------------------------------------------------------- */

  const pickerCancel = await page.evaluate(async () => {
    const st = window.enggDrawing.state;

    const objectsBefore = st.objects.length;
    const titleBefore = document.title;

    window.showSaveFilePicker = async () => {
      const error = new Error("cancelled");
      error.name = "AbortError";
      throw error;
    };

    document.querySelector('[data-file-action="save-as"]').click();
    await new Promise((r) => setTimeout(r, 700));

    return {
      objectsBefore,
      objectsAfter: st.objects.length,
      titleBefore,
      titleAfter: document.title,
      dialogOpen: Boolean(document.querySelector(".engg-dialog-backdrop")),
    };
  });

  log("pickerCancel", pickerCancel);

  return out;
}

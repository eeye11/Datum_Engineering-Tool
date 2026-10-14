/*
 * ========================================================
 * THE OPEN LAUNCHER
 * ========================================================
 *
 * File -> Open must show a Datum popup - Templates, Recent, Import - and must
 * NOT open the operating system's file panel until Import is chosen. These are
 * the acceptance checks for that change:
 *
 *   - Open with no unsaved changes shows the popup, no dialog first.
 *   - Open with unsaved changes shows Unsaved Changes FIRST, then the popup.
 *   - Save First / Discard / Cancel behave as required.
 *   - A template creates a new, clean, untitled document.
 *   - Import goes through the existing loader and adds the file to Recents.
 *   - A recent file reopens directly.
 *   - Cancelling Import changes nothing.
 */

export default async function run(page) {
  const out = { steps: [] };
  const log = (name, value) => out.steps.push({ name, value });

  await page.waitForFunction(() => typeof window.datum === "object", null, {
    timeout: 20000,
  });

  const setup = await page.evaluate(async () => {
    const report = {};

    try {
      if (typeof window.enggDrawing !== "object") {
        const mod = await import("/src/app/automation-hooks.js");
        mod.installAutomationHooks();
      }

      report.hooks = {
        drawing: typeof window.enggDrawing,
        recent: typeof window.enggRecentFiles,
        templates: typeof window.enggTemplates,
        popup: typeof window.enggOpenPopup,
      };

      window.enggRecentFiles.clear();

      report.openButton = Boolean(
        document.querySelector('[data-file-action="open"]'),
      );
    } catch (error) {
      report.error = String(error && error.message || error);
    }

    return report;
  });

  log("setup", setup);

  const tab = page.getByRole("button", { name: "Engineering Drawing" });
  if (await tab.count()) {
    await tab.first().click();
    await page.waitForTimeout(900);
  }

  /* The File toolbar only exists once the drawing tab is showing. */
  const openButton = page.locator('[data-file-action="open"]');

  await openButton.waitFor({ state: "visible", timeout: 15000 });

  /* ---------------------------------------------------------------- */
  /* Setup: a saved document body to become a "recent" and to import.   */
  /* ---------------------------------------------------------------- */

  await page.evaluate(() => {
    const ds = window.enggDrawingState;
    const st = window.enggDrawing.state;
    const F = ds.geometryFactories;

    const before = ds.snapshotDrawing(st);
    ds.addObject(st, F.line({ x: 0, y: 0 }, { x: 120, y: 0 }, { style: {} }));
    ds.commitDrawingChange(st, before);

    /* A file payload the Import path can load. */
    const body = window.enggDrawingSheets.serializeDocumentBody();
    window.__qaPayload = JSON.stringify(
      window.enggDocumentFile.createDocument(body),
    );
  });

  /* ---------------------------------------------------------------- */
  /* 1. Open (dirty) -> Unsaved Changes FIRST, then the launcher.       */
  /* ---------------------------------------------------------------- */

  await openButton.click();
  await page.waitForTimeout(400);

  const dirtyOpen = await page.evaluate(async () => {
    return {
      title: (document.querySelector(".engg-dialog-title") || {}).textContent,
      buttons: [...document.querySelectorAll(".engg-dialog-button")].map((b) =>
        b.textContent.trim(),
      ),
    };
  });

  log("dirtyOpen", dirtyOpen);

  /* Discard -> the launcher must appear. */
  const launcher = await page.evaluate(async () => {
    const discard = [...document.querySelectorAll(".engg-dialog-button")].find(
      (b) => /discard/i.test(b.textContent),
    );

    discard.click();
    await new Promise((r) => setTimeout(r, 500));

    const templates = [...document.querySelectorAll("[data-template]")].map(
      (n) => n.dataset.template,
    );
    const recents = [
      ...document.querySelectorAll("[data-recent-key]"),
    ].map((n) => n.dataset.recentKey);

    return {
      title: (document.querySelector(".engg-dialog-title") || {}).textContent,
      templates,
      recents,
      hasImport: [...document.querySelectorAll(".engg-dialog-button")].some(
        (b) => /import/i.test(b.textContent),
      ),
      bodySections: [...document.querySelectorAll(".datum-open-section-title")].map(
        (n) => n.textContent,
      ),
      /* The OS panel must NOT have opened. */
      fileInputOpened: Boolean(document.querySelector("input[type=file]")),
    };
  });

  log("launcher", launcher);

  /* ---------------------------------------------------------------- */
  /* 2. Cancel the launcher; the current drawing stays.                 */
  /* ---------------------------------------------------------------- */

  const cancelled = await page.evaluate(async () => {
    const objectsBefore = window.enggDrawing.state.objects.length;

    const cancel = [...document.querySelectorAll(".engg-dialog-button")].find(
      (b) => /cancel/i.test(b.textContent),
    );

    cancel.click();
    await new Promise((r) => setTimeout(r, 400));

    return {
      objectsBefore,
      objectsAfter: window.enggDrawing.state.objects.length,
      dialogOpen: Boolean(document.querySelector(".engg-dialog-backdrop")),
    };
  });

  log("cancelled", cancelled);

  /* ---------------------------------------------------------------- */
  /* 3. A template creates a new, clean, UNTITLED document.             */
  /* ---------------------------------------------------------------- */

  const template = await page.evaluate(async () => {
    /*
     * Reset to a clean empty document through the real New flow, so the
     * launcher is shown directly rather than behind an Unsaved prompt.
     */
    document.querySelector('[data-file-action="new"]').click();
    await new Promise((r) => setTimeout(r, 350));

    const discard = [...document.querySelectorAll(".engg-dialog-button")].find(
      (b) => /discard/i.test(b.textContent),
    );

    if (discard) {
      discard.click();
      await new Promise((r) => setTimeout(r, 400));
    }

    const before = window.enggDrawing.state.objects.length;

    document.querySelector('[data-file-action="open"]').click();
    await new Promise((r) => setTimeout(r, 450));

    const statics = document.querySelector('[data-template="statics"]');
    if (!statics) {
      return {
        error: "no statics template",
        title: (document.querySelector(".engg-dialog-title") || {}).textContent,
      };
    }

    statics.click();
    await new Promise((r) => setTimeout(r, 900));

    return {
      before,
      objects: window.enggDrawing.state.objects.length,
      title: document.title,
      dialogOpen: Boolean(document.querySelector(".engg-dialog-backdrop")),
      message: (document.getElementById("drawingToolMessage") || "")
        .textContent,
    };
  });

  log("template", template);

  /* ---------------------------------------------------------------- */
  /* 4. Import: goes to the loader, and is remembered in Recents.       */
  /* ---------------------------------------------------------------- */

  const imported = await page.evaluate(async () => {
    const raw = window.__qaPayload;

    document.querySelector('[data-file-action="open"]').click();
    await new Promise((r) => setTimeout(r, 450));

    /*
     * Intercept the file input Import creates, so the operating system's panel
     * is not needed and the file is deterministic.
     */
    const realCreate = document.createElement.bind(document);

    document.createElement = (tag) => {
      const node = realCreate(tag);
      if (String(tag).toLowerCase() === "input") {
        node.click = () => {
          Object.defineProperty(node, "files", {
            value: [
              new File([raw], "Imported.enggdraw", {
                type: "application/vnd.enggdraw+json",
              }),
            ],
            configurable: true,
          });
          node.dispatchEvent(new Event("change"));
        };
      }
      return node;
    };

    const importButton = [...document.querySelectorAll(".engg-dialog-button")].find(
      (b) => /import/i.test(b.textContent),
    );

    importButton.click();

    await new Promise((r) => setTimeout(r, 900));

    document.createElement = realCreate;

    return {
      objects: window.enggDrawing.state.objects.length,
      drawn: document.querySelectorAll(
        ".drawing-canvas svg [data-feature-id]",
      ).length,
      title: document.title,
      recents: window.enggRecentFiles.list().map((e) => e.fileName),
      message: (document.getElementById("drawingToolMessage") || {})
        .textContent,
    };
  });

  log("imported", imported);

  /* ---------------------------------------------------------------- */
  /* 5. A recent file reopens directly from the launcher.               */
  /* ---------------------------------------------------------------- */

  const reopened = await page.evaluate(async () => {
    /*
     * Start from a clean EMPTY document, so the launcher is shown directly and
     * the reopened drawing is unmistakable: it must bring its one feature back.
     */
    document.querySelector('[data-file-action="new"]').click();
    await new Promise((r) => setTimeout(r, 350));

    const newDiscard = [...document.querySelectorAll(".engg-dialog-button")].find(
      (b) => /discard/i.test(b.textContent),
    );

    if (newDiscard) {
      newDiscard.click();
      await new Promise((r) => setTimeout(r, 400));
    }

    const empty = window.enggDrawing.state.objects.length;

    document.querySelector('[data-file-action="open"]').click();
    await new Promise((r) => setTimeout(r, 450));

    const row = document.querySelector("[data-recent-key]");
    if (!row) {
      return {
        empty,
        error: "no recent row",
        title: (document.querySelector(".engg-dialog-title") || {}).textContent,
      };
    }

    row.click();
    await new Promise((r) => setTimeout(r, 900));

    return {
      empty,
      objects: window.enggDrawing.state.objects.length,
      drawn: document.querySelectorAll(
        ".drawing-canvas svg [data-feature-id]",
      ).length,
      title: document.title,
      message: (document.getElementById("drawingToolMessage") || {})
        .textContent,
    };
  });

  log("reopened", reopened);

  /* ---------------------------------------------------------------- */
  /* 6. Cancelling the Import panel changes nothing.                    */
  /* ---------------------------------------------------------------- */

  const importCancelled = await page.evaluate(async () => {
    const st = window.enggDrawing.state;

    const objectsBefore = st.objects.length;
    const titleBefore = document.title;

    document.querySelector('[data-file-action="open"]').click();
    await new Promise((r) => setTimeout(r, 400));

    const realCreate = document.createElement.bind(document);

    document.createElement = (tag) => {
      const node = realCreate(tag);
      if (String(tag).toLowerCase() === "input") {
        /* Cancelling fires `cancel` and no change. */
        node.click = () => node.dispatchEvent(new Event("cancel"));
      }
      return node;
    };

    const importButton = [...document.querySelectorAll(".engg-dialog-button")].find(
      (b) => /import/i.test(b.textContent),
    );

    importButton.click();
    await new Promise((r) => setTimeout(r, 600));

    document.createElement = realCreate;

    return {
      objectsBefore,
      objectsAfter: st.objects.length,
      titleBefore,
      titleAfter: document.title,
      dialogOpen: Boolean(document.querySelector(".engg-dialog-backdrop")),
    };
  });

  log("importCancelled", importCancelled);

  /* ---------------------------------------------------------------- */
  /* 7. Save As records the saved file in Recents.                      */
  /* ---------------------------------------------------------------- */

  const saveAsRecent = await page.evaluate(async () => {
    window.showSaveFilePicker = async () => ({
      name: "Saved.enggdraw",
      createWritable: async () => ({ write: async () => {}, close: async () => {} }),
    });

    document.querySelector('[data-file-action="save-as"]').click();
    await new Promise((r) => setTimeout(r, 700));

    return {
      recents: window.enggRecentFiles.list().map((e) => e.fileName),
      title: document.title,
    };
  });

  log("saveAsRecent", saveAsRecent);

  return out;
}

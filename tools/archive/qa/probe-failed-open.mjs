/*
 * ========================================================
 * ACCEPTANCE TEST - FAILED OPEN AND FAILED IMPORT
 * ========================================================
 *
 * A corrupt or incompatible file must leave the drawing the user already has
 * exactly as it was. The dangerous shape is
 *
 *     clear current document -> try to open -> it fails -> work is lost
 *
 * and the safe one is
 *
 *     read + validate + reconstruct a CANDIDATE -> replace only on success
 *
 * This drives the real Import action with a damaged file and checks that the
 * document, its dirty state and its file name are all untouched.
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

    /* Alerts would block the run; record them instead. */
    window.__qaAlerts = [];
    window.alert = (message) => {
      window.__qaAlerts.push(String(message));
    };

    window.enggRecentFiles.clear();
  });

  const tab = page.getByRole("button", { name: "Engineering Drawing" });
  if (await tab.count()) {
    await tab.first().click();
    await page.waitForTimeout(800);
  }

  /* A clean drawing with one feature, and a known document title. */
  const before = await page.evaluate(async () => {
    const ds = window.enggDrawingState;
    const st = window.enggDrawing.state;
    const F = ds.geometryFactories;

    st.objects = [];

    const snapshot = ds.snapshotDrawing(st);
    ds.addObject(st, F.line({ x: 0, y: 0 }, { x: 100, y: 0 }, { style: {} }));
    ds.commitDrawingChange(st, snapshot);

    /*
     * LEAVE THE DOCUMENT CLEAN, so the Import guard runs its action straight
     * away rather than waiting for an answer about unsaved changes the test is
     * not trying to exercise here.
     */
    document.querySelector('[data-file-action="new"]').click();
    await new Promise((r) => setTimeout(r, 350));

    const discard = [...document.querySelectorAll(".engg-dialog-button")].find(
      (b) => /discard/i.test(b.textContent),
    );

    if (discard) {
      discard.click();
      await new Promise((r) => setTimeout(r, 350));
    }

    /* Now put the one feature back and mark the document clean. */
    st.objects = [];
    const second = ds.snapshotDrawing(st);
    ds.addObject(st, F.line({ x: 0, y: 0 }, { x: 100, y: 0 }, { style: {} }));
    ds.commitDrawingChange(st, second);

    /*
     * Reaching a clean state through the app is awkward from a test, so the
     * document is saved to make it clean: the same route a user would take.
     */
    window.showSaveFilePicker = async () => ({
      name: "Clean.enggdraw",
      createWritable: async () => ({ write: async () => {}, close: async () => {} }),
    });

    document.querySelector('[data-file-action="save-as"]').click();
    await new Promise((r) => setTimeout(r, 600));

    return {
      objects: st.objects.length,
      ids: st.objects.map((o) => o.id),
      title: document.title,
    };
  });

  log("before", before);

  /* Import a file that is not JSON at all. */
  const afterBadImport = await page.evaluate(async () => {
    const st = window.enggDrawing.state;

    window.__qaAlerts = [];

    const realCreate = document.createElement.bind(document);

    document.createElement = (tag) => {
      const node = realCreate(tag);
      if (String(tag).toLowerCase() === "input") {
        node.click = () => {
          Object.defineProperty(node, "files", {
            value: [
              new File(["{ this is not json"], "Broken.enggdraw", {
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

    document.querySelector('[data-file-action="open"]').click();
    await new Promise((r) => setTimeout(r, 500));

    const importButton = [...document.querySelectorAll(".engg-dialog-button")].find(
      (b) => /import/i.test(b.textContent),
    );

    if (!importButton) {
      document.createElement = realCreate;
      return { error: "no import button" };
    }

    importButton.click();

    /*
     * The import runs through a promise chain and a FileReader, so give the
     * whole path time to settle before reading the outcome.
     */
    await new Promise((r) => setTimeout(r, 1800));

    document.createElement = realCreate;

    return {
      objects: st.objects.length,
      ids: st.objects.map((o) => o.id),
      title: document.title,
      alerts: window.__qaAlerts.slice(),
      message: (document.getElementById("drawingToolMessage") || "")
        .textContent,
      dialogTitle: (document.querySelector(".engg-dialog-title") || {})
        .textContent,
      dialogButtons: [
        ...document.querySelectorAll(".engg-dialog-button"),
      ].map((b) => b.textContent.trim()),
    };
  });

  log("afterBadImport", afterBadImport);

  /* And a file that is valid JSON but not a drawing. */
  const afterWrongFormat = await page.evaluate(async () => {
    const st = window.enggDrawing.state;

    window.__qaAlerts = [];

    const realCreate = document.createElement.bind(document);

    document.createElement = (tag) => {
      const node = realCreate(tag);
      if (String(tag).toLowerCase() === "input") {
        node.click = () => {
          Object.defineProperty(node, "files", {
            value: [
              new File([JSON.stringify({ hello: "world" })], "Other.json", {
                type: "application/json",
              }),
            ],
            configurable: true,
          });
          node.dispatchEvent(new Event("change"));
        };
      }
      return node;
    };

    document.querySelector('[data-file-action="open"]').click();
    await new Promise((r) => setTimeout(r, 500));

    const importButton = [...document.querySelectorAll(".engg-dialog-button")].find(
      (b) => /import/i.test(b.textContent),
    );

    importButton.click();
    await new Promise((r) => setTimeout(r, 900));

    document.createElement = realCreate;

    return {
      objects: st.objects.length,
      ids: st.objects.map((o) => o.id),
      drawn: document.querySelectorAll(".drawing-canvas svg [data-feature-id]")
        .length,
      title: document.title,
      reported: window.__qaAlerts.length > 0,
      message: (document.getElementById("drawingToolMessage") || "")
        .textContent,
    };
  });

  log("afterWrongFormat", afterWrongFormat);

  /* A v99 file from the future must be refused, not guessed at. */
  const afterFuture = await page.evaluate(async () => {
    const st = window.enggDrawing.state;

    window.__qaAlerts = [];

    const payload = JSON.stringify({
      format: "enggdraw",
      version: 99,
      document: { units: "mm", sheets: [], activeSheetId: null },
    });

    const realCreate = document.createElement.bind(document);

    document.createElement = (tag) => {
      const node = realCreate(tag);
      if (String(tag).toLowerCase() === "input") {
        node.click = () => {
          Object.defineProperty(node, "files", {
            value: [new File([payload], "Future.enggdraw", { type: "application/json" })],
            configurable: true,
          });
          node.dispatchEvent(new Event("change"));
        };
      }
      return node;
    };

    document.querySelector('[data-file-action="open"]').click();
    await new Promise((r) => setTimeout(r, 500));

    const importButton = [...document.querySelectorAll(".engg-dialog-button")].find(
      (b) => /import/i.test(b.textContent),
    );

    importButton.click();
    await new Promise((r) => setTimeout(r, 900));

    document.createElement = realCreate;

    return {
      objects: st.objects.length,
      drawn: document.querySelectorAll(".drawing-canvas svg [data-feature-id]")
        .length,
      title: document.title,
      reported: window.__qaAlerts.length > 0,
    };
  });

  log("afterFuture", afterFuture);

  return out;
}

/*
 * ========================================================
 * ACCEPTANCE TEST - RECENT FILES
 * ========================================================
 *
 *   - the SAME file opened twice is ONE entry, moved to the top
 *   - entries carry a real drawing thumbnail, not a file icon
 *   - the Recent section switches between Grid (default) and List
 *   - the view preference persists
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

    window.enggRecentFiles.clear();
    window.enggTemplates.clear();

    try {
      window.localStorage.removeItem("datum:recent-view");
    } catch (error) {
      /* ignore */
    }
  });

  const tab = page.getByRole("button", { name: "Engineering Drawing" });
  if (await tab.count()) {
    await tab.first().click();
    await page.waitForTimeout(800);
  }

  /* A drawing, saved to a file, so it becomes a recent. */
  const saved = await page.evaluate(async () => {
    const ds = window.enggDrawingState;
    const st = window.enggDrawing.state;
    const F = ds.geometryFactories;

    const before = ds.snapshotDrawing(st);
    st.objects = [];
    const beam = F.beam({ x: 0, y: 0 }, { x: 200, y: 0 }, { style: {} });
    beam.id = "beam_recent";
    st.objects.push(beam);
    ds.commitDrawingChange(st, before);

    window.showSaveFilePicker = async () => ({
      name: "Beam Analysis.enggdraw",
      createWritable: async () => ({
        write: async () => {},
        close: async () => {},
      }),
    });

    document.querySelector('[data-file-action="save-as"]').click();
    await new Promise((r) => setTimeout(r, 800));

    return {
      recents: window.enggRecentFiles.list().map((e) => ({
        name: e.fileName,
        hasPreview: Boolean(e.preview),
      })),
    };
  });

  log("saved", saved);

  /* Save As to the SAME name again: still one entry. */
  const savedTwice = await page.evaluate(async () => {
    document.querySelector('[data-file-action="save-as"]').click();
    await new Promise((r) => setTimeout(r, 800));

    return {
      count: window.enggRecentFiles.list().length,
      names: window.enggRecentFiles.list().map((e) => e.fileName),
    };
  });

  log("savedTwice", savedTwice);

  /* Open the launcher: grid by default, with a real thumbnail. */
  const gridView = await page.evaluate(async () => {
    document.querySelector('[data-file-action="open"]').click();
    await new Promise((r) => setTimeout(r, 500));

    const grid = document.querySelector(".datum-open-recents-grid");
    const rows = document.querySelectorAll("[data-recent-key]");

    const thumb = document.querySelector(".datum-open-thumb");

    return {
      isGrid: Boolean(grid),
      rowCount: rows.length,
      thumbHasSvg: Boolean(thumb && thumb.querySelector("svg")),
      switchButtons: [
        ...document.querySelectorAll(".datum-open-view-button"),
      ].map((b) => b.dataset.view),
    };
  });

  log("gridView", gridView);

  /* Switch to list. */
  const listView = await page.evaluate(async () => {
    const listButton = document.querySelector(
      '.datum-open-view-button[data-view="list"]',
    );

    listButton.click();
    await new Promise((r) => setTimeout(r, 400));

    return {
      isList: Boolean(document.querySelector(".datum-open-recents")),
      isGrid: Boolean(document.querySelector(".datum-open-recents-grid")),
      stored: window.localStorage.getItem("datum:recent-view"),
    };
  });

  log("listView", listView);

  /* Reopen the popup: the choice persisted. */
  const persisted = await page.evaluate(async () => {
    const cancel = [...document.querySelectorAll(".engg-dialog-button")].find(
      (b) => /cancel/i.test(b.textContent),
    );

    cancel.click();
    await new Promise((r) => setTimeout(r, 300));

    document.querySelector('[data-file-action="open"]').click();
    await new Promise((r) => setTimeout(r, 450));

    return {
      isList: Boolean(document.querySelector(".datum-open-recents")),
      isGrid: Boolean(document.querySelector(".datum-open-recents-grid")),
    };
  });

  log("persisted", persisted);

  return out;
}

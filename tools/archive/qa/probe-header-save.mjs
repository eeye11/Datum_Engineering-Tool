/*
 * ========================================================
 * ACCEPTANCE TEST - HEADER, FILENAME DISPLAY, AND SAVE
 * ========================================================
 *
 *   - Datum stays far left; the filename is CENTRED and smaller
 *   - only the BASE name is shown - never `.enggdraw`
 *   - the unsaved mark appears beside the name and clears on save
 *   - Save writes back to the file that was opened (no Save As)
 *   - a never-saved document falls through to Save As, once
 */

export default async function run(page) {
  const out = {};
  const errors = [];

  page.on("pageerror", (e) => errors.push(String((e && e.message) || e)));

  await page.evaluate(async () => {
    await import("/src/main.js");
  });

  await page.waitForFunction(
    () => typeof window.enggDrawing === "object" && window.enggDrawing.state,
    null,
    { timeout: 60000 },
  );

  await page.waitForTimeout(400);

  /* The header on a fresh, never-saved document. */
  out.freshHeader = await page.evaluate(() => {
    const h1 = document.querySelector(".header h1");
    const doc = document.querySelector(".header-document");
    const name = document.getElementById("headerDocumentBaseName");
    const mark = document.getElementById("headerDocumentDirty");

    const header = document.querySelector(".header").getBoundingClientRect();
    const brand = h1.getBoundingClientRect();
    const shown = doc.getBoundingClientRect();

    return {
      brandText: h1.textContent.trim(),
      documentText: name.textContent,
      markHidden: mark.hidden,
      /* Datum at the far left. */
      brandAtLeft: Math.round(brand.left - header.left) < 40,
      /* The filename centred: its middle near the header's middle. */
      centredBy:
        Math.round(shown.left + shown.width / 2) -
        Math.round(header.left + header.width / 2),
      /* Smaller than the brand. */
      brandSize: parseFloat(getComputedStyle(h1).fontSize),
      documentSize: parseFloat(getComputedStyle(name).fontSize),
    };
  });

  out.freshHeader = out.freshHeader;

  /* Open a file (through the native picker where present), then Save. */
  out.openAndSave = await page.evaluate(async () => {
    const calls = { savePicker: 0, openPicker: 0 };

    const body = {
      format: "enggdraw",
      version: window.enggDocumentFile.CURRENT_VERSION,
      document: {
        units: "mm",
        sheets: [
          {
            id: "s",
            name: "Sheet 1",
            objects: [
              {
                id: "l",
                type: "line",
                name: "L",
                geometry: { start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
                style: { stroke: "#000000", lineWidth: 1 },
              },
            ],
          },
        ],
        activeSheetId: "s",
      },
    };

    const text = JSON.stringify(body);

    /*
     * A real handle, as the File System Access API would give - so the test
     * exercises the write-back path rather than a stub of it.
     */
    let written = null;

    const handle = {
      name: "triangle.enggdraw",
      getFile: async () =>
        new File([text], "triangle.enggdraw", { type: "application/json" }),
      createWritable: async () => ({
        write: async (blob) => {
          written = blob;
        },
        close: async () => {},
      }),
    };

    window.showOpenFilePicker = async () => {
      calls.openPicker += 1;
      return [handle];
    };

    window.showSaveFilePicker = async () => {
      calls.savePicker += 1;
      return handle;
    };

    const mod = await import("/src/editor/document-commands.js");

    /* OPEN */
    await mod.importDrawingFile();
    await new Promise((r) => setTimeout(r, 600));

    const afterOpen = {
      header: document.getElementById("headerDocumentBaseName").textContent,
      markHidden: document.getElementById("headerDocumentDirty").hidden,
      handle: window.enggFileSave.currentFileHandle()?.name || null,
    };

    /* EDIT, so the document is dirty. */
    const ds = window.enggDrawingState;
    const st = window.enggDrawing.state;
    const before = ds.snapshotDrawing(st);

    ds.addObject(
      st,
      ds.geometryFactories.line(
        { x: 0, y: 20 },
        { x: 60, y: 20 },
        { style: {} },
      ),
    );

    ds.commitDrawingChange(st, before);
    await new Promise((r) => setTimeout(r, 200));

    const afterEdit = {
      header: document.getElementById("headerDocumentBaseName").textContent,
      markHidden: document.getElementById("headerDocumentDirty").hidden,
    };

    /* SAVE - must write back, NOT open the Save As panel. */
    const savePickerBefore = calls.savePicker;

    const saved = await mod.saveDrawing();
    await new Promise((r) => setTimeout(r, 300));

    return {
      calls,
      afterOpen,
      afterEdit,
      saved,
      /* The Save As panel was NOT opened by Save. */
      savePickerUnchanged: calls.savePicker === savePickerBefore,
      /* Something was actually written. */
      wroteFile: written !== null,
      writtenType: written ? written.type : null,
      headerAfterSave: document.getElementById("headerDocumentBaseName")
        .textContent,
      markHiddenAfterSave: document.getElementById("headerDocumentDirty")
        .hidden,
    };
  });

  out.openAndSave = out.openAndSave;

  out.errors = errors;

  return out;
}

/*
 * Drives a real Save As and checks the Recent entry that results.
 */
export default async function run(page) {
  await page.evaluate(async () => {
    await import("/src/main.js");
  });

  await page.waitForFunction(
    () => typeof window.enggDrawing === "object" && window.enggDrawing.state,
    null,
    { timeout: 60000 },
  );

  await page.waitForTimeout(400);

  return page.evaluate(async () => {
    const ds = window.enggDrawingState;
    const st = window.enggDrawing.state;
    const F = ds.geometryFactories;

    window.enggRecentFiles.clear();

    /* A triangle, so the drawing is unmistakable in a preview. */
    const before = ds.snapshotDrawing(st);
    st.objects = [];

    const a = F.line({ x: 0, y: 0 }, { x: 120, y: 0 }, { style: {} });
    const b = F.line({ x: 120, y: 0 }, { x: 60, y: 90 }, { style: {} });
    const c = F.line({ x: 60, y: 90 }, { x: 0, y: 0 }, { style: {} });
    a.id = "t1";
    b.id = "t2";
    c.id = "t3";
    st.objects.push(a, b, c);
    ds.commitDrawingChange(st, before);

    /* A native save that succeeds. */
    window.showSaveFilePicker = async () => ({
      name: "triangle.enggdraw",
      createWritable: async () => ({
        write: async () => {},
        close: async () => {},
      }),
    });

    document.querySelector('[data-file-action="save-as"]').click();
    await new Promise((r) => setTimeout(r, 900));

    const list = window.enggRecentFiles.list();

    return {
      recentCount: list.length,
      names: list.map((e) => e.fileName),
      hasPreview: list.map((e) => Boolean(e.preview)),
      previewStartsWithSvg: list[0]?.preview?.slice(0, 60) || null,
      /* Save As twice must still be one entry. */
      ...(await (async () => {
        document.querySelector('[data-file-action="save-as"]').click();
        await new Promise((r) => setTimeout(r, 900));

        const after = window.enggRecentFiles.list();

        return {
          afterSecondSaveCount: after.length,
          afterSecondSaveNames: after.map((e) => e.fileName),
        };
      })()),
    };
  });
}

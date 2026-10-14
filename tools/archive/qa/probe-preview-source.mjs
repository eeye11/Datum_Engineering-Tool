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

  return page.evaluate(() => {
    const ds = window.enggDrawingState;
    const st = window.enggDrawing.state;
    const F = ds.geometryFactories;

    /* Draw a triangle in the LIVE document, so the normal path runs. */
    const before = ds.snapshotDrawing(st);
    st.objects = [];

    const triangle = F.line({ x: 0, y: 0 }, { x: 100, y: 0 }, { style: {} });
    triangle.id = "tri_live";
    st.objects.push(triangle);
    ds.commitDrawingChange(st, before);

    /* The body a Save/Open would produce. */
    const body = window.enggDrawingSheets.serializeDocumentBody();

    const direct = window.enggDrawingExport.renderFittedDocument(body, {
      width: 160,
    });

    return {
      bodySheets: (body.sheets || []).length,
      bodyObjects: (body.sheets || [])[0]?.objects?.length,
      directPreview: Boolean(direct),
      directSvgLength: direct ? direct.svg.outerHTML.length : 0,
      viewBox: direct ? direct.svg.getAttribute("viewBox") : null,
    };
  });
}

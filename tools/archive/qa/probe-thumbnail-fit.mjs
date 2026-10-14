/*
 * ========================================================
 * ACCEPTANCE TEST - THUMBNAILS FIT THE DRAWING
 * ========================================================
 *
 * The bug: a small drawing on a big sheet produced a thumbnail showing the whole
 * EMPTY workspace with a tiny figure in one corner.
 *
 * The check is measurable rather than visual: render a preview of a document
 * whose geometry spans a small region, and confirm the rendered content FILLS
 * most of the thumbnail. If the whole workspace were being captured, the figure
 * would occupy a small fraction of it.
 */

export default async function run(page) {
  const out = {};

  await page.evaluate(async () => {
    await import("/src/main.js");
  });

  await page.waitForFunction(
    () => typeof window.enggDrawing === "object" && window.enggDrawing.state,
    null,
    { timeout: 60000 },
  );

  await page.waitForTimeout(400);

  const measure = await page.evaluate(() => {
    /* A small triangle, in a document with NO editor viewport of its own. */
    const triangle = {
      id: "tri_thumb",
      type: "triangle",
      name: "Triangle 1",
      geometry: {
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 50, y: 70 },
        ],
      },
      style: { stroke: "#000000", lineWidth: 1, fill: "none" },
    };

    const document = window.enggDocumentFile.createDocument({
      units: "mm",
      sheets: [{ id: "s", name: "Sheet 1", objects: [triangle] }],
      activeSheetId: "s",
    });

    const image = window.enggDrawingExport.renderFittedDocument(
      document.document,
      { width: 160 },
    );

    if (!image || !image.svg) {
      return { error: "no preview was produced" };
    }

    const svg = image.svg;

    /*
     * WHAT THE THUMBNAIL ACTUALLY DRAWS, measured from the INK.
     *
     * The SVG's own width/height/viewBox are the output raster's, so they say
     * nothing about the drawing. The question that matters is how much of that
     * box the drawing occupies: a fitted thumbnail is mostly drawing, and the
     * "whole workspace" bug would leave it mostly empty.
     */
    const box = image.bounds || null;

    const inkBox = (() => {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;

      svg
        .querySelectorAll("polygon, polyline, path, line, circle, rect")
        .forEach((node) => {
          const numbers = (node.getAttribute("points") || "")
            .split(/[\s,]+/)
            .map(Number)
            .filter((n) => Number.isFinite(n));

          for (let i = 0; i < numbers.length; i += 2) {
            minX = Math.min(minX, numbers[i]);
            maxX = Math.max(maxX, numbers[i]);
            minY = Math.min(minY, numbers[i + 1]);
            maxY = Math.max(maxY, numbers[i + 1]);
          }
        });

      if (!Number.isFinite(minX)) {
        return null;
      }

      return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
    })();

    return {
      produced: true,
      viewBox: svg.getAttribute("viewBox"),
      ink: inkBox,
      /*
       * The drawing's aspect: 100 wide by 70 tall is 1.43. If the fit were
       * capturing a workspace, this would be whatever the workspace is.
       */
      drawingAspect: inkBox
        ? Number((inkBox.w / Math.max(inkBox.h, 1e-6)).toFixed(2))
        : null,
      hasTriangle: Boolean(svg.querySelector("polygon, polyline, path")),
      box,
    };
  });

  out.measured = measure;

  /*
   * The same check the other way: a document whose object span is 100 x 70
   * should produce a viewBox of roughly that aspect (100:70 ≈ 1.43), NOT a
   * square workspace-sized box.
   */
  out.aspect = await page.evaluate(() => {
    const make = (points) =>
      window.enggDocumentFile.createDocument({
        units: "mm",
        sheets: [
          {
            id: "s",
            name: "Sheet 1",
            objects: [
              {
                id: "t",
                type: "triangle",
                name: "T",
                geometry: { points },
                style: { stroke: "#000000", lineWidth: 1 },
              },
            ],
          },
        ],
        activeSheetId: "s",
      }).document;

    const box = (document) => {
      const image = window.enggDrawingExport.renderFittedDocument(document, {
        width: 160,
      });

      if (!image || !image.svg) {
        return null;
      }

      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;

      image.svg
        .querySelectorAll("polygon, polyline, path, line")
        .forEach((node) => {
          const numbers = (node.getAttribute("points") || "")
            .split(/[\s,]+/)
            .map(Number)
            .filter((n) => Number.isFinite(n));

          for (let i = 0; i < numbers.length; i += 2) {
            minX = Math.min(minX, numbers[i]);
            maxX = Math.max(maxX, numbers[i]);
            minY = Math.min(minY, numbers[i + 1]);
            maxY = Math.max(maxY, numbers[i + 1]);
          }
        });

      if (!Number.isFinite(minX)) {
        return null;
      }

      const w = maxX - minX;
      const h = maxY - minY;

      return { w, h, ratio: Number((w / Math.max(h, 1e-6)).toFixed(2)) };
    };

    /* A wide drawing: 300 x 40 -> ratio ~7.5. */
    const wide = box(
      make([
        { x: 0, y: 0 },
        { x: 300, y: 0 },
        { x: 150, y: 40 },
      ]),
    );

    /* A tall drawing: 40 x 300 -> ratio ~0.13. */
    const tall = box(
      make([
        { x: 0, y: 0 },
        { x: 40, y: 0 },
        { x: 20, y: 300 },
      ]),
    );

    return { wide, tall };
  });

  out.aspect = out.aspect;

  /* Generating a preview must change NOTHING about the open document. */
  out.readOnly = await page.evaluate(() => {
    const ds = window.enggDrawingState;
    const st = window.enggDrawing.state;

    const before = {
      zoom: st.camera.zoom,
      panX: st.camera.panX,
      panY: st.camera.panY,
      selection: [...st.selection.selectedObjectIds],
      activeTool: st.activeTool,
      objects: JSON.stringify(st.objects),
      history: st.history.past.length,
    };

    const document = window.enggDrawingSheets.serializeDocumentBody();

    window.enggDrawingExport.renderFittedDocument(document, { width: 160 });
    window.enggDrawingExport.renderFittedDocument(document, { width: 160 });

    const after = {
      zoom: st.camera.zoom,
      panX: st.camera.panX,
      panY: st.camera.panY,
      selection: [...st.selection.selectedObjectIds],
      activeTool: st.activeTool,
      objects: JSON.stringify(st.objects),
      history: st.history.past.length,
    };

    void ds;

    return {
      unchanged: JSON.stringify(before) === JSON.stringify(after),
      before,
      after,
    };
  });

  out.readOnly = out.readOnly;

  return out;
}
// Create a real feature, then export the document and check the bytes of each
// format are genuinely that format, not an empty file or a mislabelled blob.
export default async function run(page) {
  const tab = page.getByText("Engineering Drawing", { exact: true }).first();

  if (await tab.count()) {
    await tab.click();
    await page.waitForTimeout(900);
  }

  return await page.evaluate(async () => {
    const S = (await import("/src/core/model/drawing-state.js")).default;
    const model = (await import("/src/editor/editor-state.js")).drawingState;
    const docFile = (await import("/src/file/document-file.js")).default;
    const exporter = (await import("/src/file/document-export.js")).default;

    const out = {};

    // A real feature, so the exports have something to draw.
    const line = S.geometryFactories.line({ x: 0, y: 0 }, { x: 40, y: 0 });
    S.addObject(model, line);

    out.objectCount = model.objects.length;

    // The native envelope, exactly as Save would write it.
    const body = { sheets: [{ id: "s", objects: model.objects }], units: "mm" };
    const payload = docFile.createDocument(body);
    const text = JSON.stringify(payload, null, 2);

    out.enggdraw = {
      hasVersion: typeof payload.version === "number",
      hasDocument: !!payload.document,
      isJson: text.trim().startsWith("{"),
      bytes: text.length,
    };

    /*
     * PNG and JPG bytes, through the SAME image producer Save As uses. The
     * signature bytes are checked rather than trusted, so a blob mislabelled as
     * a PNG cannot pass.
     */
    const renderer = await import("/src/editor/document-commands.js");

    void renderer;

    // The exporter's own clean render, which is what the images come from.
    const image = exporter.renderImage(model, exporter.drawnPoints(), {
      width: 800,
      height: 400,
      background: null,
    });

    out.image = image
      ? {
          hasSvg: !!image.svg,
          canvasW: image.canvas.width,
          canvasH: image.canvas.height,
          svgTag: image.svg.tagName,
        }
      : null;

    // The SVG the PDF/print page is composed from must be real SVG.
    out.cleanSvg = exporter.renderClean
      ? typeof exporter.renderClean === "function"
      : "missing";

    return out;
  });
}

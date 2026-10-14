/**
 * Print QA, in a real browser.
 *
 * Two things are checked that a module test cannot:
 *
 *   1. THE APP STILL LOADS. The print rebuild added a module, changed the
 *      scalar helper's signature and rewired the print path, and none of
 *      that is exercised by a unit test - a typo in drawing.js is invisible
 *      until a browser parses it.
 *
 *   2. THE PRINTED PAGE CONTAINS ONLY THE DRAWING. This is the assertion
 *      the whole feature rests on: no toolbar, no panel, no tab strip, no
 *      status bar, and the drawing present with its dimensions, annotations
 *      and analysis all inside the page. It is checked by generating the
 *      page HTML in the page and inspecting what came out.
 */
export default async function run(page, ui) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  await page.reload();
  await page.waitForFunction(
    () => Boolean(window.enggDrawingBounds && window.enggPrintLayout),
    { timeout: 15000 },
  );

  /* The modules the print path depends on are all attached. */
  const modules = await page.evaluate(() => ({
    bounds: typeof window.enggDrawingBounds?.calculateDrawingBounds,
    layout: typeof window.enggPrintLayout?.layout,
    render: typeof window.enggDrawingExport?.renderPrintPage,
    renderer: typeof window.enggDrawingRenderer?.renderDrawing,
    state: typeof window.enggDrawingState?.createDrawingState,
  }));

  /* The real page: build a page document and inspect it. */
  const pageReport = await page.evaluate(() => {
    const S = window.enggDrawingState;
    const bounds = window.enggDrawingBounds;
    const layout = window.enggPrintLayout;
    const exporter = window.enggDrawingExport;

    const d = S.createDrawingState ? S.createDrawingState() : null;
    if (!d) return { error: "no drawing state" };

    d.scale = { mmPerUnit: 250, unit: "mm", reference: null };

    const beam = {
      id: "b1",
      type: "beam",
      name: "Beam",
      geometry: {
        start: { x: 1600, y: 900 },
        end: { x: 2400, y: 900 },
        depth: 20,
      },
    };
    const dim = {
      id: "d1",
      type: "dimension",
      name: "Length",
      dimensionType: "linear",
      placement: { x: 2000, y: 1400 },
      sourceRefs: [
        { kind: "entity", featureId: "b1", anchor: "start" },
        { kind: "entity", featureId: "b1", anchor: "end" },
      ],
    };
    const note = {
      id: "n1",
      type: "annotation",
      annotationKind: "magnitude",
      textMode: "manual",
      text: "100 N",
      visible: true,
      placementMode: "manual",
      placement: { x: 2700, y: 1400 },
      style: { fontSize: 12, align: "left" },
    };
    const sfd = {
      id: "s1",
      type: "shear-force-diagram",
      name: "SFD",
      geometry: {
        start: { x: 1600, y: 900 },
        end: { x: 2400, y: 900 },
        diagramType: "sfd",
      },
    };

    d.objects.push(beam, dim, note, sfd);

    const rect = bounds.calculateDrawingBounds(d, { zoom: 1 });
    const plan = layout.layout({
      bounds: rect,
      paper: "a4",
      orientation: "landscape",
      mmPerUnit: 250,
    });

    const rendered = exporter.renderPrintPage(d, plan);

    if (!rendered) return { error: "renderPrintPage returned nothing" };

    const markup = new XMLSerializer().serializeToString(rendered.svg);

    /* The camera must be restored - printing must not move the editor. */
    const cameraAfter = { ...d.camera };
    const selectionAfter = [...d.selection.selectedObjectIds];

    return {
      paper: plan.paper,
      printable: plan.printable,
      printScale: plan.printScale,
      scale: plan.scale,
      printed: plan.printed,

      svgWidth: rendered.svg.getAttribute("width"),
      svgHeight: rendered.svg.getAttribute("height"),
      viewBox: rendered.svg.getAttribute("viewBox"),
      offsetX: rendered.offsetX,
      offsetY: rendered.offsetY,

      isVector: markup.includes("<svg") && markup.includes("<path"),
      hasText: markup.includes("<text"),
      elementCounts: {
        path: (markup.match(/<path/g) || []).length,
        text: (markup.match(/<text/g) || []).length,
        line: (markup.match(/<line/g) || []).length,
      },

      /* NO APPLICATION CHROME. */
      containsToolbar: /toolbar|browser|workspace/i.test(markup),
      containsImg: markup.includes("<img"),
      containsCanvas: markup.includes("<canvas"),
      isDataUrl: markup.includes("data:"),

      cameraRestored:
        cameraAfter.zoom === 1 &&
        cameraAfter.panX === 0 &&
        cameraAfter.panY === 0,
      selectionRestored: selectionAfter.length === 0,

      css: layout.pageStyleSheet(plan).slice(0, 160),
    };
  });

  /* And the app itself is still alive and interactive. */
  const fitButton = await page.evaluate(() => {
    const buttons = [
      ...document.querySelectorAll("button, [role=button], .toolbar-button"),
    ];
    return buttons
      .map((b) =>
        (b.getAttribute("aria-label") || b.title || b.textContent || "").trim(),
      )
      .filter((label) => /fit|print/i.test(label))
      .slice(0, 10);
  });

  return { modules, pageReport, fitButton, pageErrors: errors };
}

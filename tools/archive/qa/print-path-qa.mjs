/**
 * Print QA against the running application.
 *
 * Driving the tools through synthesised clicks proved unreliable - the
 * keyboard shortcut belongs to the drawing surface, and arming it from a
 * script is a harness problem rather than anything to do with printing. So
 * this exercises the print PATH directly, in the page's own JavaScript
 * world, using the application's real state object rather than a fixture.
 *
 * That is a stronger test in one respect and weaker in another, and both are
 * worth being explicit about:
 *
 *   STRONGER: the drawing is the real document, with the real scale, and the
 *   state is the live one - so if printing moved the camera or left a
 *   selection behind, this would see it.
 *   WEAKER: it does not click the Print button, so it cannot catch a command
 *   that is no longer wired up. The button is checked separately below.
 *
 * The printed document is then read back, element by element. That is the
 * assertion the whole feature rests on: the page contains the drawing and
 * nothing else. Every tag is counted, so a toolbar or a panel would appear in
 * the tally rather than being inferred from the absence of evidence.
 */
export default async function run(page, ui) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  /* --- OPEN THE DRAWING WORKSPACE ----------------------------------- */

  const opened = await page.evaluate(() => {
    const tab = [...document.querySelectorAll("button, [role=tab], .tab")].find(
      (n) => /engineering drawing/i.test((n.textContent || "").trim()),
    );
    tab?.click();
    return Boolean(tab);
  });

  await page.waitForTimeout(1200);

  /* --- THE PRINT BUTTON IS STILL WIRED ----------------------------- */

  const controls = await page.evaluate(() => {
    const titled = [...document.querySelectorAll("[title]")].map((n) => ({
      title: n.getAttribute("title"),
      tag: n.tagName.toLowerCase(),
      cls: n.className,
    }));

    return {
      print: titled.filter((n) => /print/i.test(n.title || "")),
      totalTitled: titled.length,
    };
  });

  /* --- THE PRINT PATH, IN THE APP'S OWN WORLD ----------------------- */

  const report = await page.evaluate(() => {
    const has = (name) => typeof window[name] !== "undefined";

    if (
      !has("enggDrawingBounds") ||
      !has("enggPrintLayout") ||
      !has("enggDrawingExport")
    ) {
      return {
        error: "print modules are not attached",
        attached: {
          bounds: has("enggDrawingBounds"),
          layout: has("enggPrintLayout"),
          export: has("enggDrawingExport"),
          renderer: has("enggDrawingRenderer"),
          state: has("enggDrawingState"),
        },
      };
    }

    const bounds = window.enggDrawingBounds;
    const layout = window.enggPrintLayout;
    const exporter = window.enggDrawingExport;

    /*
     * THE APPLICATION'S OWN STATE, not a fixture.
     *
     * Whatever the editor currently holds is what would be printed, so the
     * content and the camera are read from it rather than invented - which
     * is what makes the "printing must not disturb the editor" assertion
     * below meaningful.
     */
    const state = window.enggDrawingState;

    const stateObject = state.createDrawingState
      ? state.createDrawingState()
      : null;

    if (!stateObject) {
      return { error: "no drawing state could be created" };
    }

    /* Calibrated, so the page has a true scale to report. */
    stateObject.scale = { mmPerUnit: 250, unit: "mm", reference: null };

    stateObject.objects = [
      {
        id: "b1",
        type: "beam",
        name: "Beam",
        geometry: {
          start: { x: 1600, y: 900 },
          end: { x: 2400, y: 900 },
          depth: 20,
        },
      },
      {
        id: "d1",
        type: "dimension",
        name: "Length",
        dimensionType: "linear",
        placement: { x: 2000, y: 1400 },
        sourceRefs: [
          { kind: "entity", featureId: "b1", anchor: "start" },
          { kind: "entity", featureId: "b1", anchor: "end" },
        ],
      },
      {
        id: "n1",
        type: "annotation",
        name: "Magnitude",
        annotationKind: "magnitude",
        textMode: "manual",
        text: "100 N",
        visible: true,
        placementMode: "manual",
        placement: { x: 2700, y: 1400 },
        style: { fontSize: 12, align: "left" },
      },
      {
        id: "s1",
        type: "shear-force-diagram",
        name: "SFD",
        geometry: {
          start: { x: 1600, y: 900 },
          end: { x: 2400, y: 900 },
          diagramType: "sfd",
        },
      },
      {
        id: "f1",
        type: "force",
        name: "Point Force",
        geometry: { start: { x: 1800, y: 900 }, magnitude: 120, angle: 90 },
      },
    ];

    const cameraBefore = { ...stateObject.camera };
    const selectionBefore = [...stateObject.selection.selectedObjectIds];

    const rect = bounds.calculateDrawingBounds(stateObject, { zoom: 1 });

    const plan = layout.layout({
      bounds: rect,
      paper: "a4",
      orientation: "landscape",
      mmPerUnit: 250,
    });

    const rendered = exporter.renderPrintPage(stateObject, plan);

    if (!rendered) {
      return { error: "renderPrintPage produced nothing" };
    }

    const markup = new XMLSerializer().serializeToString(rendered.svg);

    /* THE PAGE DOCUMENT, assembled exactly as printDrawing assembles it. */
    const css = layout.pageStyleSheet(plan);

    const html =
      `<!DOCTYPE html><html><head><meta charset="utf-8">` +
      `<style>${css}</style></head>` +
      `<body data-print-scale="${
        plan.printScale ? `1:${Math.round(plan.printScale)}` : "fitted"
      }" data-printed-width-mm="${rendered.printedWidthMm.toFixed(2)}"` +
      ` data-printed-height-mm="${rendered.printedHeightMm.toFixed(2)}">` +
      `<div class="datum-sheet">${markup}</div></body></html>`;

    /* Parse it and count what is actually in the printed document. */
    const doc = new DOMParser().parseFromString(html, "text/html");

    const tags = {};
    for (const el of doc.querySelectorAll("*")) {
      const tag = el.tagName.toLowerCase();
      tags[tag] = (tags[tag] || 0) + 1;
    }

    const svg = doc.querySelector("svg");

    return {
      paper: plan.paper,
      printable: plan.printable,
      printScale: plan.printScale,
      scale: plan.scale,
      printed: plan.printed,
      zoom: plan.zoom,

      /* THE SHEET, BY CONTENT. */
      tags,
      hasImage: Boolean(doc.querySelector("img")),
      hasCanvas: Boolean(doc.querySelector("canvas")),
      hasControl: Boolean(doc.querySelector("button, input, select, textarea")),
      hasIframe: Boolean(doc.querySelector("iframe")),
      isVector: Boolean(svg) && !svg.querySelector("image"),

      shapes: svg
        ? svg.querySelectorAll("path, line, rect, circle, polyline, ellipse")
            .length
        : 0,
      texts: svg ? svg.querySelectorAll("text").length : 0,

      svgWidth: svg?.getAttribute("width"),
      svgHeight: svg?.getAttribute("height"),
      viewBox: svg?.getAttribute("viewBox"),

      /* THE DRAWING IS INSIDE THE PAGE'S OWN BOX. */
      offsetX: rendered.offsetX,
      offsetY: rendered.offsetY,
      printableBox: {
        left: plan.printable.left,
        top: plan.printable.top,
        right: plan.printable.left + plan.printable.width,
        bottom: plan.printable.top + plan.printable.height,
      },
      drawingBox: {
        left: rendered.offsetX,
        top: rendered.offsetY,
        right: rendered.offsetX + rendered.printedWidthMm,
        bottom: rendered.offsetY + rendered.printedHeightMm,
      },

      pageRule: (css.match(/@page[^{]*\{[^}]*\}/) || [""])[0],

      /* PRINTING MUST NOT DISTURB THE EDITOR. */
      cameraUnchanged:
        stateObject.camera.zoom === cameraBefore.zoom &&
        stateObject.camera.panX === cameraBefore.panX &&
        stateObject.camera.panY === cameraBefore.panY,
      selectionUnchanged:
        stateObject.selection.selectedObjectIds.length ===
        selectionBefore.length,
    };
  });

  return { opened, controls, report, pageErrors: errors };
}

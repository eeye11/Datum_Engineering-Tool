export default async function run(page, ui) {
  const errs = [];
  page.on("pageerror", (e) =>
    errs.push("PAGEERROR: " + e.message.slice(0, 200)),
  );
  page.on("console", (m) => {
    if (m.type() === "error") errs.push("CONSOLE: " + m.text().slice(0, 160));
  });

  await page.goto("http://localhost:8099/", { waitUntil: "load" });
  await page.waitForTimeout(2000);
  const tab = page
    .locator("button", { hasText: "Engineering Drawing" })
    .first();
  if (await tab.count()) await tab.click();
  await page.waitForTimeout(1500);

  const out = { errs };
  const b = await page.locator(".drawing-workspace").first().boundingBox();
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;

  // A line, dimensioned, plus a labelled force - so there is a
  // dimension AND an annotation to find in the output.
  await page.locator('#drawingToolList [data-tool-id="line"]').click();
  await page.waitForTimeout(300);
  await page.mouse.click(cx - 150, cy - 60);
  await page.waitForTimeout(300);
  await page.mouse.click(cx + 100, cy - 60);
  await page.waitForTimeout(600);

  await page.locator('button[data-category="STATICS"]').click();
  await page.waitForTimeout(400);
  await page.locator('#drawingToolList [data-tool-id="point-force"]').click();
  await page.waitForTimeout(300);
  await page.mouse.click(cx - 100, cy + 70);
  await page.waitForTimeout(250);
  await page.mouse.move(cx - 80, cy + 45);
  await page.waitForTimeout(250);
  await page.mouse.click(cx - 80, cy + 45);
  await page.waitForTimeout(600);

  await page.locator('button[data-category="ANNOTATE"]').click();
  await page.waitForTimeout(400);
  await page.locator('#drawingToolList [data-tool-id="dimension"]').click();
  await page.waitForTimeout(250);
  await page.mouse.click(cx, cy - 60);
  await page.waitForTimeout(400);
  await page.mouse.click(cx, cy - 140);
  await page.waitForTimeout(800);

  // Read what the live canvas shows, then what EXPORT renders.
  out.result = await page
    .evaluate(() => {
      const s = document.createElement("script");
      s.textContent = `
    (function(){
      const R = {};
      const st = window.enggDrawing.state;

      // What is actually on the drawing.
      R.liveTexts = [...document.querySelectorAll('svg .drawing-feature text')]
        .map(t => t.textContent.trim()).filter(Boolean);

      R.hasDimension = st.objects.some(o => o.type === 'dimension');

      // The value we will look for.
      const dim = st.objects.find(o => o.type === 'dimension');
      R.dimValue = dim ? window.enggDimensionModel.formatMeasurement(dim, st) : null;

      /*
       * The EXPORT path. Rendered into a detached host at a size of
       * its own, so this exercises the same call the PNG/JPG/SVG/print
       * buttons make rather than reading the editor's own canvas.
       */
      try {
        const host = document.createElement('div');
        host.style.cssText = 'position:absolute;left:-9999px;top:0;width:800px;height:600px;';
        document.body.appendChild(host);
        const canvas = document.createElement('canvas');
        canvas.width = 800; canvas.height = 600;
        host.appendChild(canvas);

        const pts = window.enggDrawingExport.renderImage(
          st,
          window.enggDrawingExport.contentBounds(st.objects),
          { width: 800, height: 600 }
        );

        const svg = canvas.querySelector('svg');
        R.exportOk = !!svg;
        R.exportTexts = svg
          ? [...svg.querySelectorAll('text')].map(t => t.textContent.trim()).filter(Boolean)
          : [];
        R.exportHasArrows = svg ? svg.querySelectorAll('polygon').length : 0;
        host.remove();
      } catch (e) {
        R.exportError = e.message;
      }

      /*
       * The DRAWING REFERENCE path: a state built from a sheet's own
       * objects, which is what a written solution renders.
       */
      try {
        const sheetId = window.enggDrawing.getActiveSheetId
          ? window.enggDrawing.getActiveSheetId()
          : null;
        R.sheetId = sheetId;
      } catch (e) { R.sheetIdErr = e.message; }

      document.documentElement.setAttribute('data-res', JSON.stringify(R));
    })();`;
      document.body.appendChild(s);
      return null;
    })
    .then(() => page.getAttribute("html", "data-res"))
    .then((v) => JSON.parse(v || "null"));

  return out;
}

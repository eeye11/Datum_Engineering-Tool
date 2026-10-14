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

  const b = await page.locator(".drawing-workspace").first().boundingBox();
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;

  // A line, dimensioned.
  await page.locator('button[data-category="GEOMETRY"]').click();
  await page.waitForTimeout(400);
  await page.locator('#drawingToolList [data-tool-id="line"]').click();
  await page.waitForTimeout(250);
  await page.mouse.click(cx - 150, cy - 100);
  await page.waitForTimeout(200);
  await page.mouse.click(cx + 100, cy - 100);
  await page.waitForTimeout(700);

  await page.locator('button[data-category="ANNOTATE"]').click();
  await page.waitForTimeout(400);
  await page.locator('#drawingToolList [data-tool-id="dimension"]').click();
  await page.waitForTimeout(250);
  await page.mouse.click(cx, cy - 100);
  await page.waitForTimeout(400);
  await page.mouse.click(cx, cy - 190);
  await page.waitForTimeout(700);

  // Reads the stored text plus the zoom, from the page's own world.
  const read = () =>
    page
      .evaluate(() => {
        const s = document.createElement("script");
        s.textContent = `
          (function(){
            const st = window.enggDrawing.state;
            const dim = st.objects.find(o => o.type === 'dimension');
            document.documentElement.setAttribute('data-res', JSON.stringify({
              zoom: st.camera.zoom,
              text: dim ? window.enggDimensionModel.formatMeasurement(dim, st) : null
            }));
          })();`;
        document.body.appendChild(s);
        return null;
      })
      .then(() => page.getAttribute("html", "data-res"))
      .then(JSON.parse);

  const out = { errs };
  out.at100 = await read();

  // Zoom in, several notches, using the app's own zoom tool.
  await page.locator('button[data-category="VIEW"]').click();
  await page.waitForTimeout(400);
  const zoomTool = page.locator('#drawingToolList [data-tool-id="zoom"]');
  if (await zoomTool.count()) {
    await zoomTool.click();
    await page.waitForTimeout(300);
    for (let i = 0; i < 4; i++) {
      await page.mouse.click(cx, cy);
      await page.waitForTimeout(250);
    }
  }
  out.zoomed = await read();

  // Pan the view, then read again.
  const panTool = page.locator('#drawingToolList [data-tool-id="pan"]');
  if (await panTool.count()) {
    await panTool.click();
    await page.waitForTimeout(300);
    await page.mouse.move(cx + 120, cy + 90);
    await page.mouse.down();
    await page.mouse.move(cx + 40, cy + 30, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(500);
  }
  out.panned = await read();

  // The drawn text should still be on the drawing and readable.
  out.drawnText = await page.evaluate(() =>
    [...document.querySelectorAll("svg .drawing-feature text")]
      .map((t) => t.textContent.trim())
      .filter(Boolean),
  );

  out.zoomChangedValue = out.at100.text !== out.zoomed.text;
  out.panChangedValue = out.zoomed.text !== out.panned.text;

  return out;
}

export default async function run(page, ui) {
  await page.goto("http://localhost:8099/", { waitUntil: "load" });
  await page.waitForTimeout(2000);
  const tab = page
    .locator("button", { hasText: "Engineering Drawing" })
    .first();
  if (await tab.count()) await tab.click();
  await page.waitForTimeout(1500);

  const b = await page.locator(".drawing-workspace").first().boundingBox();
  const cx = b.x + b.width / 2,
    cy = b.y + b.height / 2;

  await page.locator('button[data-category="GEOMETRY"]').click();
  await page.waitForTimeout(400);
  await page.locator('#drawingToolList [data-tool-id="line"]').click();
  await page.waitForTimeout(250);
  await page.mouse.click(cx - 150, cy - 120);
  await page.waitForTimeout(200);
  await page.mouse.click(cx + 100, cy - 120);
  await page.waitForTimeout(600);

  await page.locator('button[data-category="ANNOTATE"]').click();
  await page.waitForTimeout(400);
  await page.locator('#drawingToolList [data-tool-id="dimension"]').click();
  await page.waitForTimeout(250);
  await page.mouse.click(cx, cy - 120);
  await page.waitForTimeout(400);
  await page.mouse.click(cx, cy - 200);
  await page.waitForTimeout(700);

  await page.evaluate(() => {
    const s = document.createElement("script");
    s.textContent = `
    (function(){
      const st = window.enggDrawing.state, DS = window.enggDrawingState, DM = window.enggDimensionModel;
      const dim = st.objects.find(o => o.type === 'dimension');
      const line = st.objects.find(o => o.type === 'line');
      const read = () => DM.formatMeasurement(dim, st);
      const R = { at100: read() };

      // Move the endpoint the way a geometry edit does, through the app's own commit.
      const prev = DS.snapshotDrawing(st);
      line.geometry.end = { x: line.geometry.end.x + 120, y: line.geometry.end.y };
      DS.commitDrawingChange(st, prev);
      R.afterMoveModel = read();

      DS.undo(st);
      R.afterUndoModel = read();

      // Redo and confirm it follows again.
      DS.redo(st);
      R.afterRedoModel = read();

      DS.undo(st);
      document.documentElement.setAttribute('data-res', JSON.stringify(R));
    })();`;
    document.body.appendChild(s);
  });
  await page.waitForTimeout(500);
  return JSON.parse(await page.getAttribute("html", "data-res"));
}

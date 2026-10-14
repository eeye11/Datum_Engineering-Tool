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

  // Draw a line and dimension it on the FIRST sheet.
  await page.locator('#drawingToolList [data-tool-id="line"]').click();
  await page.waitForTimeout(300);
  await page.mouse.click(cx - 150, cy - 100);
  await page.waitForTimeout(300);
  await page.mouse.click(cx + 100, cy - 100);
  await page.waitForTimeout(600);

  await page.locator('button[data-category="ANNOTATE"]').click();
  await page.waitForTimeout(400);
  await page.locator('#drawingToolList [data-tool-id="dimension"]').click();
  await page.waitForTimeout(250);
  await page.mouse.click(cx, cy - 100);
  await page.waitForTimeout(400);
  await page.mouse.click(cx, cy - 190);
  await page.waitForTimeout(700);

  /*
   * Reads the active sheet, its dimensions, and the id of the first one.
   */
  const read = () =>
    page
      .evaluate(() => {
        const s = document.createElement("script");
        s.textContent = `
          (function(){
            const sheets = window.enggDrawing.getSheets();
            const activeId = window.enggDrawing.getActiveSheetId();
            const active = sheets.find(x => x.id === activeId);
            const st = window.enggDrawing.state;
            document.documentElement.setAttribute('data-res', JSON.stringify({
              sheetCount: sheets.length,
              sheetNames: sheets.map(x => x.name),
              activeName: active ? active.name : null,
              visibleDimensions: st.objects.filter(o => o.type === 'dimension').length,
              perSheetDimensions: sheets.map(x => (x.objects || []).filter(o => o.type === 'dimension').length),
              firstDimId: (active && (active.objects||[]).find(o => o.type === 'dimension') || {}).id || null
            }));
          })();`;
        document.body.appendChild(s);
        return null;
      })
      .then(() => page.getAttribute("html", "data-res"))
      .then((v) => JSON.parse(v || "null"));

  out.onSheet1 = await read();

  // Add a second sheet.
  const added = await page.evaluate(() => {
    const s = document.createElement("script");
    s.textContent = `
      (function(){
        try {
          window.enggDrawing.addSheet ? window.enggDrawing.addSheet() : null;
        } catch(e) { document.documentElement.setAttribute('data-err', e.message); }
      })();`;
    document.body.appendChild(s);
    return null;
  });
  void added;
  await page.waitForTimeout(400);

  const api = await page.evaluate(() => {
    const s = document.createElement("script");
    s.textContent =
      "document.documentElement.setAttribute('data-api', Object.keys(window.enggDrawing).sort().join(','));";
    document.body.appendChild(s);
    return null;
  });
  void api;
  out.drawingApi = ((await page.getAttribute("html", "data-api")) || "").split(
    ",",
  );

  return out;
}

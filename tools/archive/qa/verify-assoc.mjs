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

  const readText = () =>
    page
      .evaluate(() => {
        const s = document.createElement("script");
        s.textContent = `
      (function(){
        const t = [...document.querySelectorAll('svg text')].map(x=>x.textContent.trim()).filter(Boolean);
        document.documentElement.setAttribute('data-t', JSON.stringify(t));
      })();`;
        document.body.appendChild(s);
        return null;
      })
      .then(() => page.getAttribute("html", "data-t"))
      .then(JSON.parse);

  const before = await readText();

  // Move the line's endpoint through the app's own move tool.
  await page.locator('button[data-category="ANNOTATE"]').click();
  await page.waitForTimeout(300);
  await page.locator('#drawingToolList [data-tool-id="select"]').click();
  await page.waitForTimeout(300);

  // Move the geometry directly through state, as the Move tool would.
  const moved = await page.evaluate(() => {
    const s = document.createElement("script");
    s.textContent = `
    (function(){
      const st = window.enggDrawing.state, DS = window.enggDrawingState;
      const line = st.objects.find(o => o.type === 'line');
      const prev = DS.snapshotDrawing(st);
      line.geometry.end = { x: line.geometry.end.x + 120, y: line.geometry.end.y };
      DS.commitDrawingChange(st, prev);
      document.documentElement.setAttribute('data-ok','yes');
    })();`;
    document.body.appendChild(s);
    return (page) => page;
  });
  await page.waitForTimeout(800);

  const after = await readText();

  // Undo should restore it.
  await page.locator("#drawingUndo").click();
  await page.waitForTimeout(700);
  const undone = await readText();

  return { before, afterMove: after, afterUndo: undone };
}

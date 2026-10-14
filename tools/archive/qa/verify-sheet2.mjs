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

  const state = () =>
    page
      .evaluate(() => {
        const s = document.createElement("script");
        s.textContent = `
          (function(){
            const st = window.enggDrawing.state;
            const dims = st.objects.filter(o => o.type === 'dimension');
            document.documentElement.setAttribute('data-res', JSON.stringify({
              visibleDims: dims.length,
              dimId: dims[0] ? dims[0].id : null,
              tabs: [...document.querySelectorAll('.drawing-sheet-tab')].map(t => ({
                id: t.getAttribute('data-sheet-id'),
                name: (t.querySelector('.drawing-sheet-tab-name')||{}).textContent,
                active: t.classList.contains('active')
              }))
            }));
          })();`;
        document.body.appendChild(s);
        return null;
      })
      .then(() => page.getAttribute("html", "data-res"))
      .then((v) => JSON.parse(v || "null"));

  out.onSheet1 = await state();

  // Add a second sheet.
  await page.locator(".drawing-sheet-add").click();
  await page.waitForTimeout(900);
  out.afterAdd = await state();

  // Go back to the first sheet.
  await page.locator('.drawing-sheet-tab[data-sheet-index="0"]').click();
  await page.waitForTimeout(900);
  out.backOnSheet1 = await state();

  // Rename it, then confirm the dimension survived with its id intact.
  await page.locator(".drawing-sheet-tab .drawing-sheet-tab-name").dblclick();
  await page.waitForTimeout(500);
  out.renameBox = await page.evaluate(() => {
    const i =
      document.querySelector("input[type=text]:not([id])") ||
      [...document.querySelectorAll("input")].find(
        (x) => x.offsetParent !== null,
      );
    return i ? { value: i.value, cls: i.className } : "NO VISIBLE INPUT";
  });

  const input = page.locator("input[type=text]:visible").first();
  if (await input.count()) {
    await input.fill("Free Body");
    await input.press("Enter");
    await page.waitForTimeout(800);
  }
  out.afterRename = await state();

  await page.screenshot({
    path: "sheet-rename.png",
    clip: { x: b.x, y: b.y - 60, width: Math.min(b.width, 820), height: 300 },
  });
  return out;
}

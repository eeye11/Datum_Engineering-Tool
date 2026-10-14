export default async function run(page, ui) {
  const errs = [];
  page.on("pageerror", (e) =>
    errs.push("PAGEERROR: " + e.message.slice(0, 200)),
  );
  page.on("console", (m) => {
    if (m.type() === "error") errs.push("CONSOLE: " + m.text().slice(0, 200));
  });

  await page.goto("http://localhost:8099/", { waitUntil: "load" });
  await page.waitForTimeout(2000);
  const tab = page
    .locator("button", { hasText: "Engineering Drawing" })
    .first();
  if (await tab.count()) await tab.click();
  await page.waitForTimeout(1500);
  await page.locator('button[data-category="ANNOTATE"]').click();
  await page.waitForTimeout(500);

  const out = { errs };

  // 1. Is the Dimension tool now present in the Annotate area?
  out.tools = await page.evaluate(() =>
    [...document.querySelectorAll("#drawingToolList [data-tool-id]")].map((b) =>
      b.getAttribute("data-tool-id"),
    ),
  );

  // 2. Draw a line, then dimension it through the real tool.
  const canvas = page.locator(".drawing-workspace svg").first();
  const box = await page
    .locator("#drawingCanvas, canvas, .drawing-workspace svg")
    .first()
    .boundingBox();

  // Build state via the app's own factory to avoid fighting the UI for geometry.
  await page.evaluate(() => {
    const s = document.createElement("script");
    s.textContent = `
      (function(){
        const St = window.enggDrawingState, D = window.enggDrawStateAccess;
        // find the live state through the drawing module
        window.__st = window.__st || null;
        document.documentElement.setAttribute('data-probe','set');
      })();`;
    document.body.appendChild(s);
  });

  return out;
}

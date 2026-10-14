export default async function run(page) {
  const out = {};

  await page.waitForFunction(() => typeof window.datum === "object", null, {
    timeout: 20000,
  });

  out.afterDatum = await page.evaluate(() => ({
    drawing: typeof window.enggDrawing,
    state: typeof window.enggDrawingState,
    sheets: typeof window.enggDrawingSheets,
  }));

  const tab = page.getByRole("button", { name: "Engineering Drawing" });
  out.tabCount = await tab.count();
  if (await tab.count()) {
    await tab.first().click();
    await page.waitForTimeout(900);
  }

  out.afterTab = await page.evaluate(() => ({
    drawing: typeof window.enggDrawing,
    state: typeof window.enggDrawingState,
    sheets: typeof window.enggDrawingSheets,
    canvas: Boolean(document.querySelector(".drawing-canvas")),
    url: location.href,
  }));

  out.probe = await page.evaluate(() => {
    try {
      return { objects: window.enggDrawing.state.objects.length };
    } catch (e) {
      return { error: String((e && e.message) || e) };
    }
  });

  return out;
}

/*
 * Zoom and per-sheet viewports.
 *
 * The sheet UI must be invisible to the zoom system, and the zoom
 * system must be invisible to the sheet UI. That is checked here by
 * changing the zoom through every control that exists, switching
 * sheets, and confirming that each sheet came back to the zoom it was
 * left at - and that nothing the tab bar did disturbed it.
 */
export default async function run(page) {
  const out = {};

  async function ask(body) {
    await page.addScriptTag({
      content:
        "(function(){var o;try{o=(function(){" +
        body +
        "})();}catch(e){o={e:String(e)};}" +
        "document.documentElement.setAttribute('data-p',JSON.stringify(o));})();",
    });

    const raw = await page.evaluate(() =>
      document.documentElement.getAttribute("data-p")
    );

    await page.evaluate(() =>
      document.documentElement.removeAttribute("data-p")
    );

    return raw === null ? null : JSON.parse(raw);
  }

  const zoom = () =>
    ask(
      "var s = window.enggDrawing.state;" +
        "return { factor: s.camera.zoom," +
        "percent: Math.round(s.camera.zoom * 100)," +
        "readout: document.getElementById('drawingZoomValue').value," +
        "panX: Math.round(s.camera.panX), panY: Math.round(s.camera.panY) };"
    );

  const setZoom = async (percent) => {
    const field = page.locator("#drawingZoomValue");
    await field.click();
    await field.fill(String(percent));
    await field.press("Enter");
    await page.waitForTimeout(350);
  };

  await page
    .getByRole("button", { name: "Engineering Drawing" })
    .click();
  await page.waitForSelector(".drawing-sheet-tab");

  await ask(
    "var M = window.enggDrawing.model;" +
      "M.addObject(window.enggDrawing.state, M.geometryFactories.beam(" +
      "{ x: -40, y: 0 }, { x: 40, y: 0 }));" +
      "M.commitDrawingChange(window.enggDrawing.state, []);" +
      "return true;"
  );

  /* The required percentages, through the field. */
  for (const percent of [50, 100, 150, 200]) {
    await setZoom(percent);
    out[`zoom${percent}`] = await zoom();
  }

  /* And through the buttons, which must step from the current zoom. */
  await page.locator("#drawingZoomIn").click();
  await page.waitForTimeout(350);
  out.afterZoomIn = await zoom();

  await page.locator("#drawingZoomOut").click();
  await page.waitForTimeout(350);
  out.afterZoomOut = await zoom();

  /*
   * A value with a floating point artefact must be rounded away. This
   * is the sanitiser's job, and the sheet system must not bypass it.
   */
  await setZoom(149.7);
  out.sanitised = await zoom();

  await setZoom(150);

  /* Fit, then confirm the fit became this sheet's viewport. */
  await page.getByRole("button", { name: "Fit" }).click();
  await page.waitForTimeout(500);
  out.afterFit = await zoom();

  out.viewportsAfterFit = await ask(
    "return window.enggDrawingSheets.all().map(function (s) {" +
      "return { name: s.name, zoom: s.viewport.zoom };" +
      "});"
  );

  /* A second sheet, zoomed differently. */
  await page.locator(".drawing-sheet-add").click();
  await page.waitForTimeout(400);
  await setZoom(80);
  out.sheetTwoZoom = await zoom();

  await page.locator(".drawing-sheet-tab").first().click();
  await page.waitForTimeout(400);
  out.backOnSheetOne = await zoom();

  await page.locator(".drawing-sheet-tab").nth(1).click();
  await page.waitForTimeout(400);
  out.backOnSheetTwo = await zoom();

  out.eachSheetHasItsOwn = await ask(
    "return window.enggDrawingSheets.all().map(function (s) {" +
      "return { name: s.name, zoom: s.viewport.zoom," +
      "panX: Math.round(s.viewport.panX) };" +
      "});"
  );

  /* Every sheet-UI action must leave the zoom alone. */
  const before = await zoom();

  await page.locator(".drawing-sheet-tab").nth(1).hover();
  await page.waitForTimeout(250);
  out.zoomAfterHover = { before, after: await zoom() };

  await page
    .locator(".drawing-sheet-tab")
    .nth(1)
    .click({ button: "right" });
  await page.waitForSelector(".drawing-sheet-menu");
  out.zoomAfterContextMenu = await zoom();

  await page.locator(".drawing-sheet-add").click();
  await page.waitForTimeout(400);
  out.zoomAfterCreate = await zoom();

  await page
    .locator(".drawing-sheet-tab")
    .nth(1)
    .click({ button: "right" });
  await page.waitForSelector(".drawing-sheet-menu");
  await page
    .locator(".drawing-sheet-menu button", { hasText: "Move Right" })
    .click();
  await page.waitForTimeout(400);
  out.zoomAfterReorder = await zoom();

  /* A window resize must not reset the zoom. */
  await page.setViewportSize({ width: 700, height: 600 });
  await page.waitForTimeout(500);
  out.zoomAfterResize = await zoom();

  /* And the saved document carries each sheet's zoom. */
  out.saved = await ask(
    "var b = window.enggDrawingSheets.serializeDocumentBody();" +
      "return b.sheets.map(function (s) {" +
      "return { name: s.name, zoom: s.viewport.zoom };" +
      "});"
  );

  return out;
}

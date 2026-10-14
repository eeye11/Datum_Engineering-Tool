/*
 * Verify the state synchronisation requirements against the RUNNING app:
 *
 *   - the six menus open, and only one at a time
 *   - Grid / Dimensions / Magnitudes toolbar state matches the View menu
 *   - Command Search finds commands and runs real ones
 *   - Ctrl+K focuses the search field
 *   - the theme setting applies and persists
 *
 * Read-only apart from the interactions it is testing.
 */
export default async function run(page) {
  await page.getByRole("button", { name: "Engineering Drawing" }).click();
  await page.waitForTimeout(400);

  const results = {};

  /* ---- the six menus, and one at a time ---- */
  const labels = await page.locator(".datum-menu-label").allTextContents();
  results.menuLabels = labels;

  await page.locator('.datum-menu-label[data-menu-id="file"]').click();
  await page.waitForTimeout(150);
  results.fileMenuOpen = await page.locator(".datum-menu-panel-file").count();

  /* Opening Edit must close File. */
  await page.locator('.datum-menu-label[data-menu-id="edit"]').click();
  await page.waitForTimeout(150);
  results.afterSwitchingToEdit = {
    file: await page.locator(".datum-menu-panel-file").count(),
    edit: await page.locator(".datum-menu-panel-edit").count(),
  };

  /* Escape closes. */
  await page.keyboard.press("Escape");
  await page.waitForTimeout(150);
  results.afterEscape = await page.locator(".datum-menu-panel").count();

  /* ---- toolbar <-> View menu synchronisation ---- */
  const stateBefore = await page.evaluate(() => ({
    grid: document
      .getElementById("drawingGridToggle")
      .getAttribute("aria-pressed"),
    dims: document
      .getElementById("drawingDimensionsToggle")
      .getAttribute("aria-pressed"),
    mags: document
      .getElementById("drawingMagnitudesToggle")
      .getAttribute("aria-pressed"),
  }));

  /* Toggle the grid from the TOOLBAR, then read the View menu's label. */
  await page.locator("#drawingGridToggle").click();
  await page.waitForTimeout(200);
  await page.locator('.datum-menu-label[data-menu-id="view"]').click();
  await page.waitForTimeout(200);

  const gridItemLabel = await page
    .locator('.datum-menu-item[data-menu-item="grid"] .datum-menu-item-label')
    .textContent();

  results.gridSync = {
    toolbarBefore: stateBefore.grid,
    toolbarAfter: await page.evaluate(() =>
      document.getElementById("drawingGridToggle").getAttribute("aria-pressed"),
    ),
    viewMenuSays: gridItemLabel,
  };

  /* Toggle it back from the MENU, and check the toolbar followed. */
  await page.locator('.datum-menu-item[data-menu-item="grid"]').click();
  await page.waitForTimeout(250);
  results.gridAfterMenuClick = await page.evaluate(() =>
    document.getElementById("drawingGridToggle").getAttribute("aria-pressed"),
  );

  /* ---- command search ---- */
  const search = page.locator("#drawingCommandSearch");
  await search.click();
  await search.fill("Dark Mode");
  await page.waitForTimeout(250);

  results.searchDarkMode = await page
    .locator(".datum-search-result-label")
    .allTextContents();

  await search.fill("Trim");
  await page.waitForTimeout(250);
  results.searchTrim = await page
    .locator(".datum-search-result-label")
    .allTextContents();

  /* Escape closes the results. */
  await page.keyboard.press("Escape");
  await page.waitForTimeout(150);
  results.searchClosedAfterEscape =
    (await page.locator(".datum-search-results").count()) === 0;

  /* ---- Ctrl+K focuses the field ---- */
  await page.locator(".drawing-canvas").click({ position: { x: 200, y: 200 } });
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press("Control+k");
  await page.waitForTimeout(200);
  results.ctrlKFocusedSearch = await page.evaluate(
    () => document.activeElement?.id === "drawingCommandSearch",
  );
  await page.keyboard.press("Escape");

  /* ---- theme applies immediately ---- */
  const themeCycle = await page.evaluate(async () => {
    const mod = await import("/src/editor/theme.js");
    const seen = [];
    for (const t of ["dark", "light", "system"]) {
      mod.setThemePreference(t);
      seen.push(document.documentElement.getAttribute("data-theme"));
    }
    return { seen, stored: localStorage.getItem("datum.theme") };
  });
  results.themeCycle = themeCycle;

  return results;
}

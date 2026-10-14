/*
 * ========================================================
 * RESPONSIVE LAYOUT: WIDE -> COMPACT -> ICON-ONLY
 * ========================================================
 *
 * Checks the properties the responsive rules must keep at every width:
 *
 *   - the top toolbar stays ONE ROW (never wraps into a second)
 *   - the section bar stays ONE ROW
 *   - the Tools and Features panels both stay present
 *   - both Hide buttons stay present
 *   - the page does NOT scroll horizontally (the drawing stays anchored)
 *   - at narrow widths the Tools panel switches to icons (labels gone)
 *   - the drawing canvas keeps a real, visible area
 */
export default async function run(page) {
  const errs = [];

  page.on("pageerror", (e) =>
    errs.push("PAGEERROR: " + e.message.slice(0, 220)),
  );
  page.on("console", (m) => {
    if (m.type() === "error") errs.push("CONSOLE: " + m.text().slice(0, 180));
  });

  await page.evaluate(async () => {
    await import("/src/main.js");
  });
  await page.waitForFunction(
    () => !!(window.enggDrawing && window.enggDrawing.state),
    { timeout: 15000 },
  );

  const tab = page
    .locator("button", { hasText: "Engineering Drawing" })
    .first();
  if (await tab.count()) await tab.click();
  await page.waitForTimeout(900);

  const measure = () =>
    page.evaluate(() => {
      const q = (s) => document.querySelector(s);
      const h = (el) => (el ? Math.round(el.getBoundingClientRect().height) : 0);

      const toolbar = q(".drawing-app-toolbar");
      const sections = q(".drawing-toolbar");
      const canvas = q(".drawing-canvas");
      const toolPanel = q("#drawingToolPanel");
      const featuresPanel = q("#drawingFeaturesPanel");
      const toolToggle = q("#drawingToolPanelToggle");
      const featuresToggle = q("#drawingFeaturesPanelToggle");

      const toolLabels = [
        ...document.querySelectorAll(".drawing-tool-label"),
      ];
      const visibleToolLabels = toolLabels.filter(
        (el) => el.getBoundingClientRect().width > 0,
      ).length;

      // How many ROWS the bar occupies. Measured from the BUTTONS, whose top
      // edges are what actually matter, and reported alongside whether the bar
      // is scrolling horizontally (which is the intended overflow behaviour).
      const rowCount = (el) => {
        if (!el) return 0;
        const items = [...el.querySelectorAll("button")];
        if (!items.length) return 0;
        const tops = new Set(
          items.map((c) => Math.round(c.getBoundingClientRect().top)),
        );
        return tops.size;
      };

      const scrollable = (el) =>
        el ? el.scrollWidth > el.clientWidth + 1 : false;

      return {
        toolbarHeight: h(toolbar),
        toolbarRows: rowCount(toolbar),
        toolbarScrolls: scrollable(toolbar),
        sectionHeight: h(sections),
        sectionRows: rowCount(sections),
        sectionScrolls: scrollable(sections),
        canvasW: canvas ? Math.round(canvas.getBoundingClientRect().width) : 0,
        canvasH: canvas ? Math.round(canvas.getBoundingClientRect().height) : 0,
        toolPanelShown: !!toolPanel && toolPanel.offsetParent !== null,
        toolPanelWidth: toolPanel
          ? Math.round(toolPanel.getBoundingClientRect().width)
          : 0,
        featuresPanelShown:
          !!featuresPanel && featuresPanel.offsetParent !== null,
        featuresPanelWidth: featuresPanel
          ? Math.round(featuresPanel.getBoundingClientRect().width)
          : 0,
        toolToggleShown: !!toolToggle && toolToggle.offsetParent !== null,
        featuresToggleShown: !!featuresToggle && featuresToggle.offsetParent !== null,
        toolLabelCount: toolLabels.length,
        visibleToolLabels,
        docScrollW: document.documentElement.scrollWidth,
        viewportW: window.innerWidth,
        horizontalPageOverflow:
          document.documentElement.scrollWidth > window.innerWidth + 1,
      };
    });

  const widths = [1400, 1024, 900, 760, 620, 520, 460, 390, 360];
  const results = {};

  for (const w of widths) {
    await page.setViewportSize({ width: w, height: 820 });
    await page.waitForTimeout(450);
    results[w] = await measure();
  }

  // Back to desktop: panels and labels must return.
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.waitForTimeout(500);
  results.backToDesktop = await measure();

  return { errs, results };
}

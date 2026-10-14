export default async function run(page, ui) {
  const before = await page.evaluate(() => ({
    hasShowTab: typeof window.showTab,
    scriptTags: [...document.querySelectorAll("script[src]")].map((s) =>
      s.getAttribute("src"),
    ),
    drawingSection: !!document.getElementById("drawing"),
    panelModule: typeof window.enggPropertyPanel,
  }));

  await page.evaluate(() => window.showTab?.("drawing"));
  await page.waitForTimeout(2000);

  const after = await page.evaluate(() => ({
    panelModule: typeof window.enggPropertyPanel,
    panelFns: Object.keys(window.enggPropertyPanel || {}).length,
    annotModel: typeof window.enggAnnotationModel,
    drawingHidden: document
      .getElementById("drawing")
      ?.classList.contains("hidden"),
    canvasCount: document.querySelectorAll("canvas").length,
    canvasIds: [...document.querySelectorAll("canvas")].map(
      (c) => c.id || "(no id)",
    ),
    // Did the browser even fetch the module?
    panelScriptPresent: [...document.querySelectorAll("script[src]")].some(
      (s) => (s.getAttribute("src") || "").includes("property-panel.js"),
    ),
  }));

  return { before, after };
}

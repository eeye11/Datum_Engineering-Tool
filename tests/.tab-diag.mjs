/*
 * Diagnose why the Engineering Drawing tab does not switch: is the handler
 * bound, does the section exist, and does the module graph even load?
 */
export default async function run(page, ui) {
  await page.waitForTimeout(1200);

  return await page.evaluate(async () => {
    const out = {};

    const tabs = [...document.querySelectorAll(".tab[data-tab]")];
    out.tabCount = tabs.length;
    out.tabNames = tabs.map((t) => t.dataset.tab);

    out.sections = [...document.querySelectorAll(".review-content")].map(
      (s) => ({
        id: s.id,
        active: s.classList.contains("active"),
      }),
    );

    // Is anything listening on the tab? Monkey-patch to find out.
    out.hasClickListener = tabs.some(
      (t) =>
        typeof getEventListeners === "function" &&
        getEventListeners(t).click?.length > 0,
    );

    // Try dispatching the click directly and see if the DOM reacts.
    const drawing = document.querySelector("#drawing");
    tabs.find((t) => t.dataset.tab === "drawing")?.click();
    await new Promise((r) => setTimeout(r, 300));
    out.afterSyntheticClick = {
      drawingActive: drawing?.classList.contains("active"),
      writingActive: document
        .querySelector("#writing")
        ?.classList.contains("active"),
    };

    // Can the module be imported at all? This surfaces a syntax/parse error.
    try {
      const mod = await import("/src/app/tabs.js");
      out.tabsModuleLoads = typeof mod.showTab === "function";
    } catch (e) {
      out.tabsModuleError = String(e).slice(0, 300);
    }

    try {
      const mod = await import("/src/editor/canvas-render.js");
      out.canvasRenderLoads = typeof mod.renderCurrentDrawing === "function";
    } catch (e) {
      out.canvasRenderError = String(e).slice(0, 400);
    }

    try {
      const mod = await import("/src/main.js");
      out.mainLoads = Boolean(mod);
    } catch (e) {
      out.mainError = String(e).slice(0, 400);
    }

    return out;
  });
}

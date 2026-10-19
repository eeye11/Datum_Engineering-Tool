/*
 * Captures module-graph failures that `pageerror` does not surface.
 *
 * A script/module that fails to LOAD fires an `error` event on its own element,
 * not on `window`, so a listener on `window` never hears it. That is the one
 * remaining place a silent abort can hide, so this listens in the capture phase
 * for resource errors as well.
 */
export default async function run(page) {
  const log = [];

  await page.addInitScript(() => {
    window.__errs = [];
    const record = (what, detail) => window.__errs.push(`${what}: ${detail}`);

    // Resource errors do NOT bubble, so capture phase is required to see them.
    window.addEventListener(
      "error",
      (e) => {
        if (e.target && e.target !== window && e.target.tagName) {
          const src = e.target.src || e.target.href || "(inline)";
          record("RESOURCE", `${e.target.tagName} ${src}`);
        } else {
          record("ERROR", e.message || String(e.error));
        }
      },
      true,
    );

    window.addEventListener("unhandledrejection", (e) =>
      record("REJECTION", String(e.reason && (e.reason.message || e.reason))),
    );
  });

  await page.goto("http://localhost:5173/", { waitUntil: "load" });
  await page.waitForTimeout(2500);

  log.push(...(await page.evaluate(() => window.__errs || [])));

  const state = await page.evaluate(() => ({
    datum: typeof window.datum,
    hooks: typeof window.enggDrawingStateLive,
    menuItems: document.getElementById("datumMenuBar")?.children.length ?? -1,
    drawingToolButtons: document.querySelectorAll(
      "#drawing .drawing-tool-button, #drawing [data-tool]",
    ).length,
    sheetTabs: document.querySelectorAll("#drawing [data-sheet-id]").length,
  }));

  return { state, log };
}
/*
 * Does the page reload between two consecutive queries?
 *
 * waitForFunction("the global exists") SUCCEEDED, and the evaluate issued
 * immediately after it reported the same global as undefined. Nothing else
 * explains that except the document being replaced in between.
 *
 * So: stamp a value onto the page, wait, then read it back. If the stamp is
 * gone, the page reloaded.
 */
export default async function run(page, ui) {
  await page.evaluate(() => {
    window.__stamp = "set-by-qa";
    window.__stampTime = Date.now();
  });

  await page.waitForTimeout(1500);

  const after = await page.evaluate(() => ({
    stamp: window.__stamp ?? null,
    readyState: document.readyState,
    renderer: typeof window.enggDrawingRenderer,
    enggGlobals: Object.keys(window).filter((k) => /^engg/i.test(k)),
  }));

  /*
   * And how many script tags exist NOW versus what we saw before - a
   * reload would re-parse them, and the count is a cheap proxy for it.
   */
  const scripts = await page.evaluate(
    () => document.querySelectorAll("script[src]").length,
  );

  return { after, scripts };
}

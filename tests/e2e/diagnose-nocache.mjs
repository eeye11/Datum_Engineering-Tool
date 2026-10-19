/*
 * Loads the app with HTTP caching disabled and the module cache defeated.
 *
 * Every probe so far has been ambiguous because a stale module can render the
 * menu bar while the current source - with its markers - never runs. This
 * disables caching at the network layer, navigates with a cache-busting query,
 * and reports the entry module's own markers alongside the rendered output.
 */
export default async function run(page, ui) {
  // Make every request go to the network.
  await page.route("**/*", (route) => {
    const headers = {
      ...route.request().headers(),
      "cache-control": "no-cache",
      pragma: "no-cache",
    };
    route.continue({ headers });
  });

  await page.goto(`http://localhost:5173/?nocache=${Date.now()}`, {
    waitUntil: "load",
  });
  await page.waitForTimeout(3500);

  const raw = await page.evaluate(() => ({
    boot: window.__enggBoot ?? "UNDEFINED",
    tail: window.__enggEntryTailReached ?? "UNDEFINED",
    hooks: typeof window.enggDrawingStateLive,
    datum: typeof window.datum,
    menuItems: document.getElementById("datumMenuBar")?.children.length ?? -1,
    toolButtons: document.querySelectorAll("#drawing .drawing-tool").length,
    installedFlag: window.__enggAutomationHooksInstalled ?? "UNDEFINED",
    keyCount: Object.getOwnPropertyNames(window).filter((k) =>
      /^engg|^datum/.test(k),
    ).length,
  }));

  return raw;
}

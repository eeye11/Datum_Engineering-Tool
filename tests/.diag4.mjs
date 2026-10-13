/*
 * Ask the page directly: does main.js complete, and which of its late imports
 * fail? Import each module in the same order main.js does and report the first
 * one that throws.
 */
export default async function run(page, ui) {
  await page.waitForTimeout(1200);

  return await page.evaluate(async () => {
    const paths = [
      "/src/main.js",
      "/src/editor/theme.js",
      "/src/editor/theme-preference.js",
      "/src/ui/menubar/menu-bar.js",
      "/src/editor/menu-commands.js",
      "/src/app/daetum-mark.js",
    ];

    const results = {};

    for (const p of paths) {
      try {
        const mod = await import(p);
        results[p] = { ok: true, keys: Object.keys(mod).slice(0, 8) };
      } catch (e) {
        results[p] = { ok: false, error: String(e).slice(0, 500) };
      }
    }

    // Did the menu bar mount?
    results.menuMounted = Boolean(
      document.querySelector("#datumMenuBar")?.children.length,
    );
    results.menuChildren =
      document.querySelector("#datumMenuBar")?.children.length ?? null;

    // Is the error log recording anything?
    results.errorLog =
      globalThis.window?.enggErrorLog?.entries?.() ||
      globalThis.window?.__enggErrors ||
      null;

    results.bodyChars = document.body.innerText.length;

    return results;
  });
}

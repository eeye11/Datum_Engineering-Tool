/*
 * Reads the automation hooks AFTER the module graph has demonstrably finished.
 *
 * Every earlier probe ran `--eval` immediately on navigation, which races the
 * ES module graph: the menu bar exists (it is built early) while the statements
 * at the end of the entry module have not run yet. This waits for the LAST
 * thing the entry does - `window.datum` - and only then reports.
 */
export default async function run(page) {
  const started = Date.now();

  let settled;
  try {
    await page.waitForFunction(() => typeof window.datum !== "undefined", {
      timeout: 8000,
    });
    settled = `datum appeared after ${Date.now() - started}ms`;
  } catch (e) {
    settled = `datum NEVER appeared after ${Date.now() - started}ms (${e.name})`;
  }

  const state = await page.evaluate(() => ({
    datum: typeof window.datum,
    hooks: typeof window.enggDrawingStateLive,
    menuItems: document.getElementById("datumMenuBar")?.children.length ?? -1,
  }));

  return { settled, state };
}
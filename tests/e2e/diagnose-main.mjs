/*
 * Finds WHERE main.js stops executing.
 *
 * The app renders fully and the console is clean, yet `installAutomationHooks`
 * and `window.datum` never happen - so something between the menu bar (line 94)
 * and the hooks (line 114) is throwing, and the error is not reaching the
 * console. This installs a listener FIRST and then re-imports the entry module
 * with a cache-busting query, so the throw is captured as it happens.
 */
export default async function run(page) {
  const captured = [];

  page.on("pageerror", (e) => captured.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") captured.push(`console.error: ${m.text()}`);
  });

  // Re-evaluate the entry module and report what it does.
  const result = await page.evaluate(async () => {
    try {
      // A fresh URL defeats the module cache so the module body runs again.
      await import(`/src/app/entry/main.js?probe=${Date.now()}`);
      return { threw: false, datum: typeof window.datum };
    } catch (e) {
      return {
        threw: true,
        message: String(e && e.message),
        stack: String(e && e.stack)
          .split("\n")
          .slice(0, 6)
          .join(" | "),
      };
    }
  });

  return { result, captured };
}

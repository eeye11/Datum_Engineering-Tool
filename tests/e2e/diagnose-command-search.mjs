/*
 * Narrows the silent stop to a single statement between the menu bar and the
 * automation hooks.
 *
 * Execution reaches `installMenuBar` (line 94) and never reaches
 * `installAutomationHooks` (line 114). The only statements between them are the
 * command-search calls, so each is invoked here in isolation and its outcome
 * reported.
 */
export default async function run(page) {
  return page.evaluate(async () => {
    const out = {};
    const field = document.getElementById("drawingCommandSearch");

    out.fieldPresent = !!field;

    try {
      const mod = await import(
        `/src/components/layout/toolbar/command-search.js?probe=${Date.now()}`
      );
      out.exports = Object.keys(mod);

      try {
        mod.installCommandSearch(field);
        out.installCommandSearch = "ok";
      } catch (e) {
        out.installCommandSearch = `THREW: ${e.message}`;
      }

      try {
        mod.installCommandSearchShortcut(field);
        out.installCommandSearchShortcut = "ok";
      } catch (e) {
        out.installCommandSearchShortcut = `THREW: ${e.message}`;
      }
    } catch (e) {
      out.importThrew = e.message;
    }

    return out;
  });
}

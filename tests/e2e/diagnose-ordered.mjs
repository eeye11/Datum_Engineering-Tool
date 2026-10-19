/*
 * Walks the entry module's own statements IN ORDER, in the live page, logging
 * each. Everything works in isolation, so the failure must be an interaction
 * between them - this finds which.
 */
export default async function run(page) {
  return page.evaluate(async () => {
    const out = [];
    const stamp = Date.now();

    const run = async (label, fn) => {
      try {
        const r = await fn();
        out.push(`${label} => ${r}`);
      } catch (e) {
        out.push(`${label} => THREW ${e.message}`);
      }
    };

    await run("installSavedTheme", async () => {
      const m = await import(
        `/src/components/layout/workspace/theme.js?o=${stamp}`
      );
      m.installSavedTheme();
      return "ok";
    });

    await run("installThemePreference", async () => {
      const m = await import(
        `/src/components/layout/workspace/theme-preference.js?o=${stamp}`
      );
      m.installThemePreference();
      return "ok";
    });

    await run("installMenuBar", async () => {
      const bar = await import(
        `/src/components/layout/menu-bar/menu-bar.js?o=${stamp}`
      );
      const cmds = await import(
        `/src/components/layout/menu-bar/menu-commands.js?o=${stamp}`
      );
      bar.installMenuBar(document.getElementById("datumMenuBar"), cmds.MENUS);
      return "ok";
    });

    await run("installCommandSearch", async () => {
      const m = await import(
        `/src/components/layout/toolbar/command-search.js?o=${stamp}`
      );
      m.installCommandSearch(document.getElementById("drawingCommandSearch"));
      return "ok";
    });

    await run("installCommandSearchShortcut", async () => {
      const m = await import(
        `/src/components/layout/toolbar/command-search.js?o=${stamp}`
      );
      m.installCommandSearchShortcut(
        document.getElementById("drawingCommandSearch"),
      );
      return "ok";
    });

    await run("installGlobalErrorHandlers", async () => {
      const m = await import(`/src/app/error-log.js?o=${stamp}`);
      (m.default || m).installGlobalErrorHandlers();
      return "ok";
    });

    await run("installAutomationHooks", async () => {
      const m = await import(`/src/app/automation-hooks.js?o=${stamp}`);
      m.installAutomationHooks();
      return `ok, hooks=${typeof window.enggDrawingStateLive}`;
    });

    await run("createDatumApi", async () => {
      const m = await import(`/src/shared/integration/datum-api.js?o=${stamp}`);
      window.__d = m.createDatumApi();
      return "ok";
    });

    await run("installEmbedBridge", async () => {
      const m = await import(
        `/src/shared/integration/embed-bridge.js?o=${stamp}`
      );
      m.installEmbedBridge(window.__d);
      return "ok";
    });

    return out;
  });
}

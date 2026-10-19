/*
 * Runs each statement from `installMenuBar` (line 94) to `installEmbedBridge`
 * (line 124) in isolation, in the page, and reports which one is the last to
 * succeed.
 *
 * The app renders the menu bar and nothing after it runs, with no error
 * reported. Running the same statements by hand in the live page tells us
 * whether the sequence is inherently broken or only broken during the real
 * boot.
 */
export default async function run(page) {
  return page.evaluate(async () => {
    const out = {};
    const stamp = Date.now();
    const load = (p) => import(`${p}?seq=${stamp}`);

    const steps = [
      [
        "errorLog.installGlobalErrorHandlers",
        async () => {
          const m = await load("/src/app/error-log.js");
          const log = m.default || m;
          if (typeof log.installGlobalErrorHandlers !== "function") {
            return "NOT a function";
          }
          log.installGlobalErrorHandlers();
          return "ok";
        },
      ],
      [
        "installAutomationHooks",
        async () => {
          const m = await load("/src/app/automation-hooks.js");
          if (typeof m.installAutomationHooks !== "function") {
            return "NOT a function";
          }
          m.installAutomationHooks();
          return "ok";
        },
      ],
      [
        "createDatumApi",
        async () => {
          const m = await load("/src/shared/integration/datum-api.js");
          if (typeof m.createDatumApi !== "function") {
            return "NOT a function";
          }
          window.__datumProbe = m.createDatumApi();
          return "ok";
        },
      ],
      [
        "installEmbedBridge",
        async () => {
          const m = await load("/src/shared/integration/embed-bridge.js");
          if (typeof m.installEmbedBridge !== "function") {
            return "NOT a function";
          }
          m.installEmbedBridge(window.__datumProbe);
          return "ok";
        },
      ],
    ];

    for (const [name, fn] of steps) {
      try {
        out[name] = await fn();
      } catch (e) {
        out[name] = `THREW: ${e.message}`;
      }
    }

    out.afterHooks = typeof window.enggDrawingStateLive;
    return out;
  });
}

export default async function run(page) {
  const logs = [];
  page.on("console", (m) => logs.push(`${m.type()}: ${m.text()}`));
  page.on("pageerror", (e) => logs.push(`pageerror: ${e.message}`));

  await page.evaluate(async () => {
    for (const path of [
      "/src/app/entry/main.js",
      "/src/components/layout/toolbar/toolbar.js",
      "/src/components/layout/toolbar/toolbar-wiring.js",
      "/src/features/workspace/interaction/canvas-events.js",
      "/src/features/workspace/interaction/creation-drag.js",
      "/src/features/workspace/interaction/canvas-click.js",
      "/src/features/workspace/editor-state.js",
      "/src/components/layout/toolbar/tool-activation.js",
    ]) {
      try {
        await import(path);
        window.__LOG = (window.__LOG || []).concat(`ok ${path}`);
      } catch (error) {
        window.__LOG = (window.__LOG || []).concat(
          `FAIL ${path}: ${error.message}`,
        );
      }
    }
  });

  return {
    log: await page.evaluate(() => window.__LOG),
    logs,
  };
}

export default async function run(page) {
  const logs = [];
  page.on("console", (m) => logs.push(`${m.type()}: ${m.text()}`));
  page.on("pageerror", (e) => logs.push(`pageerror: ${e.message}`));

  return await page
    .evaluate(async () => {
      const mod = await import("/src/features/workspace/editor-state.js");

      return {
        tool: mod.drawingState.activeTool,
        objects: mod.drawingState.objects.length,
        keys: Object.keys(window).filter((k) => /engg|datum|__engg/i.test(k)),
        trav: document.querySelectorAll("[data-editor-traveler], canvas")
          .length,
      };
    })
    .then((state) => ({ state, logs }));
}

export default async function run(page) {
  const logs = [];
  page.on("pageerror", (e) => logs.push(`pageerror: ${e.message}`));

  await page.evaluate(async () => {
    await import("/src/features/workspace/interaction/canvas-events.js");
  });

  await page.waitForTimeout(500);

  const status = () =>
    page.evaluate(() =>
      JSON.stringify({
        tool: window.enggDrawingStateLive?.activeTool ?? null,
        n: window.enggDrawingStateLive?.objects?.length ?? null,
        phase: window.enggDrawingStateLive?.interaction?.phase ?? null,
        msg: (
          document.querySelector("#drawingToolMessage")?.textContent || ""
        ).trim(),
      }),
    );

  const buttons = await page.evaluate(() => ({
    newTab: [...document.querySelectorAll("button")]
      .map((b) => b.textContent.trim())
      .slice(0, 12),
    drawingTabNeedsOpen: true,
  }));

  const before = await status();

  return { before, buttons, logs };
}

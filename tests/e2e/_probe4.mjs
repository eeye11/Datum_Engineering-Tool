export default async function run(page) {
  await page.getByText("Engineering Drawing", { exact: true }).first().click();
  await page.waitForTimeout(1200);

  const info = await page.evaluate(() => {
    const line = [...document.querySelectorAll("[data-tool-id]")].find(
      (n) => n.getAttribute("data-tool-id") === "line",
    );

    line?.click();

    return {
      globals: Object.keys(window)
        .filter((k) => /datum|engg|drawing/i.test(k))
        .slice(0, 40),
      lineHandlers: Boolean(line),
    };
  });

  await page.waitForTimeout(400);

  const after = await page.evaluate(async () => {
    const a = await import("/src/features/workspace/editor-state.js?t=a");
    const b = await import("/src/features/workspace/editor-state.js?t=b");

    return {
      aTool: a.drawingState.activeTool,
      bTool: b.drawingState.activeTool,
      same: a.drawingState === b.drawingState,
      highlighted: [
        ...document.querySelectorAll(
          ".drawing-tool.active, [data-tool-id].active",
        ),
      ].map((n) => n.getAttribute("data-tool-id")),
      message: document.querySelector("#drawingToolMessage")?.textContent,
    };
  });

  return { info, after };
}

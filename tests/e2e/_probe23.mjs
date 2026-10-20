export default async function run(page) {
  await page.waitForFunction(() => Boolean(window.enggDrawingStateLive), null, {
    timeout: 30000,
  });

  await page.getByRole("button", { name: "Engineering Drawing" }).click();
  await page.waitForTimeout(1200);

  return await page.evaluate(() => {
    const s = window.enggDrawingStateLive;
    const b = document
      .querySelector(".drawing-canvas")
      ?.getBoundingClientRect();

    return {
      tool: s.activeTool,
      canvas: b ? { x: b.x, y: b.y, w: b.width, h: b.height } : null,
      toolButtons: [...document.querySelectorAll(".drawing-tool")]
        .slice(0, 10)
        .map((n) => n.getAttribute("data-tool-id")),
    };
  });
}

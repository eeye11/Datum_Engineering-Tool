export default async function run(page) {
  await page.getByRole("button", { name: "Engineering Drawing" }).click();
  await page.waitForTimeout(1500);

  return await page.evaluate(() => {
    const s = window.enggDrawingStateLive;

    return {
      live: Boolean(s),
      tool: s?.activeTool ?? null,
      canvasBox: (() => {
        const b = document
          .querySelector(".drawing-canvas")
          ?.getBoundingClientRect();
        return b ? { x: b.x, y: b.y, w: b.width, h: b.height } : null;
      })(),
      tools: document.querySelectorAll("[data-tool-id]").length,
      keys: Object.keys(window).filter((k) => /engg|datum/i.test(k)),
      visiblePanels: [...document.querySelectorAll(".drawing-tool")]
        .slice(0, 12)
        .map((n) => n.getAttribute("data-tool-id")),
    };
  });
}

export default async function run(page) {
  await page.getByText("Engineering Drawing", { exact: true }).first().click();
  await page.waitForTimeout(1500);

  return await page.evaluate(() => {
    const nodes = [...document.querySelectorAll("[data-tool-id]")];
    const line = nodes.find((n) => n.getAttribute("data-tool-id") === "line");
    const r = line?.getBoundingClientRect();

    return {
      count: nodes.length,
      ids: nodes.map((n) => n.getAttribute("data-tool-id")).slice(0, 30),
      lineBox: r
        ? {
            x: r.x,
            y: r.y,
            w: r.width,
            h: r.height,
            display: getComputedStyle(line).display,
          }
        : null,
      canvas: (() => {
        const c = document.querySelector(".drawing-canvas");
        const b = c?.getBoundingClientRect();
        return b ? { x: b.x, y: b.y, w: b.width, h: b.height } : null;
      })(),
    };
  });
}

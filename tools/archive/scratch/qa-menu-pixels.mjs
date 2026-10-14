// Sample the actual rendered colours of: menu bar, panel, panel item area,
// canvas beside the panel, to quantify the "white block" contrast.
export default async function run(page, ui) {
  const wait = (ms) => page.waitForTimeout(ms);
  await page.waitForSelector(".datum-menubar", {
    timeout: 15000,
    state: "attached",
  });
  await page.evaluate(() => {
    const genTab = [...document.querySelectorAll("button, [role=tab]")].find(
      (b) => /engineering drawing/i.test(b.textContent || ""),
    );
    genTab?.click();
  });
  await wait(400);
  await page.evaluate(() => {
    document.body.classList.remove("datum-topbar-hidden");
    document.documentElement.setAttribute("data-theme", "light");
  });
  await wait(400);
  await page.evaluate(() => {
    document.querySelector('.datum-menu-label[data-menu-id="tools"]')?.click();
  });
  await wait(300);

  // Use html2canvas-free approach: read pixels via getComputedStyle is not enough.
  // Instead, screenshot into a canvas using the browser's own capture: we can't.
  // So take element rectangles and report painted colours we can compute.
  return await page.evaluate(() => {
    const rgb = (s) => {
      const m = s.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      return m ? [+m[1], +m[2], +m[3]] : null;
    };
    const dist = (a, b) =>
      a && b
        ? Math.round(
            Math.sqrt(
              (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2,
            ),
          )
        : null;
    const bg = (sel) => {
      const e = typeof sel === "string" ? document.querySelector(sel) : sel;
      return e ? rgb(getComputedStyle(e).backgroundColor) : null;
    };

    const panel = document.querySelector(".datum-menu-panel-tools");
    const canvas = document.querySelector("canvas");
    const bar = document.querySelector(".datum-menubar");

    const panelBg = bg(panel);
    const barBg = bg(bar);
    const canvasBg =
      bg(canvas) ||
      rgb(
        getComputedStyle(
          document.querySelector(".drawing-canvas-wrap") || document.body,
        ).backgroundColor,
      );
    const pageBg = bg("body");

    return {
      panelBg,
      barBg,
      canvasBg,
      pageBg,
      contrastPanelVsBar: dist(panelBg, barBg),
      contrastPanelVsCanvas: dist(panelBg, canvasBg),
      contrastBarVsPage: dist(barBg, pageBg),
      panelRect: panel.getBoundingClientRect().toJSON(),
    };
  });
}

// Dump the full painted-layer stack for the open Tools menu, plus per-item
// heights, to find every element painting a light background and the true box.
export default async function run(page) {
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

  return await page.evaluate(() => {
    const wrap = document
      .querySelector('.datum-menu-label[data-menu-id="tools"]')
      .closest(".datum-menu");

    const painted = [];
    wrap.querySelectorAll("*").forEach((n) => {
      const cs = getComputedStyle(n);
      const b = cs.backgroundColor;
      if (b && b !== "rgba(0, 0, 0, 0)" && b !== "transparent") {
        const r = n.getBoundingClientRect();
        painted.push({
          sel: n.className || n.tagName,
          bg: b,
          w: Math.round(r.width),
          h: Math.round(r.height),
        });
      }
    });

    const panel = wrap.querySelector(".datum-menu-panel-tools");
    const rows = [...panel.children].map((c) => {
      const r = c.getBoundingClientRect();
      return { cls: c.className, h: Math.round(r.height) };
    });

    // What is actually at the pixel just under the panel and beside it?
    const pr = panel.getBoundingClientRect();
    const at = (x, y) => {
      const e = document.elementFromPoint(x, y);
      if (!e) return null;
      const cs = getComputedStyle(e);
      return { cls: String(e.className), bg: cs.backgroundColor };
    };

    return {
      panelBox: {
        x: Math.round(pr.x),
        y: Math.round(pr.y),
        w: Math.round(pr.width),
        h: Math.round(pr.height),
      },
      panelBg: getComputedStyle(panel).backgroundColor,
      paintedLayers: painted,
      rowCount: rows.length,
      rows,
      belowPanel: at(Math.round(pr.x + 40), Math.round(pr.bottom + 10)),
      rightOfPanel: at(Math.round(pr.right + 40), Math.round(pr.top + 100)),
      page: at(1250, 400),
    };
  });
}

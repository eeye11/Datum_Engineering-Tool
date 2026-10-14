// Re-inspect the Tools menu exactly as it renders now: screenshot + pixel probes.
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

  // Force a distinct page background so a white panel would be obvious.
  await page.evaluate(() => {
    document.body.style.background = "#c0392b";
  });
  await wait(200);

  return await page.evaluate(() => {
    const p = document.querySelector(".datum-menu-panel-tools");
    const cs = getComputedStyle(p);
    const r = p.getBoundingClientRect();
    const label = document.querySelector(
      '.datum-menu-label[data-menu-id="tools"]',
    );
    const wrap = document.querySelector(".drawing-menu-controls-bar");
    return {
      panelBg: cs.backgroundColor,
      panelBorderColor: cs.borderColor,
      panelSize: {
        w: Math.round(r.width),
        h: Math.round(r.height),
        x: Math.round(r.x),
        y: Math.round(r.y),
      },
      openLabelBg: label ? getComputedStyle(label).backgroundColor : null,
      wrapBg: wrap ? getComputedStyle(wrap).backgroundColor : null,
      menubarBg: getComputedStyle(document.querySelector(".datum-menubar"))
        .backgroundColor,
      menuToken: getComputedStyle(document.documentElement)
        .getPropertyValue("--datum-menu")
        .trim(),
      htmlAttrs: document.documentElement.getAttribute("data-theme"),
      bodyClass: document.body.className,
    };
  });
}

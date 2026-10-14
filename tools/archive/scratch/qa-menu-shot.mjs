// Open the Tools menu in light mode and take a screenshot of it in context.
export default async function run(page, ui) {
  const wait = (ms) => page.waitForTimeout(ms);
  await page.waitForSelector(".datum-menubar", {
    timeout: 15000,
    state: "attached",
  });

  // Make sure we are in the Drawing workspace (the menubar belongs to it).
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

  // Open Tools.
  await page.evaluate(() => {
    const label = document.querySelector(
      '.datum-menu-label[data-menu-id="tools"]',
    );
    label?.click();
  });
  await wait(300);

  const info = await page.evaluate(() => {
    const bar = document.querySelector(".datum-menubar");
    const panel = document.querySelector(".datum-menu-panel-tools");
    const r = (e) => {
      if (!e) return null;
      const b = e.getBoundingClientRect();
      return {
        x: Math.round(b.x),
        y: Math.round(b.y),
        w: Math.round(b.width),
        h: Math.round(b.height),
      };
    };
    return {
      barRect: r(bar),
      panelRect: r(panel),
      barDisplay: bar ? getComputedStyle(bar).display : null,
      bodyClass: document.body.className,
    };
  });

  return { info };
}

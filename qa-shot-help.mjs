// Open the Help menu in the active theme and leave it open for a screenshot.
export default async function run(page) {
  const wait = (ms) => page.waitForTimeout(ms);
  const theme = process.env.THEME || "light";

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
  await page.evaluate((t) => {
    document.body.classList.remove("datum-topbar-hidden");
    document.documentElement.setAttribute("data-theme", t);
  }, theme);
  await wait(300);
  await page.evaluate(() => {
    document.querySelector('.datum-menu-label[data-menu-id="help"]')?.click();
  });
  await wait(300);

  return await page.evaluate(() => {
    const p = document.querySelector(".datum-menu-panel-help");
    const label = document.querySelector(
      '.datum-menu-label[data-menu-id="help"]',
    );
    return {
      panelBg: p ? getComputedStyle(p).backgroundColor : null,
      labelBg: label ? getComputedStyle(label).backgroundColor : null,
      items: p
        ? [...p.querySelectorAll(".datum-menu-item-label")].map(
            (l) => l.textContent,
          )
        : [],
    };
  });
}

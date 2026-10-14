// Open Tools, open the Modify submenu, and report both panel surfaces in the
// active theme — then leave the menu open for a screenshot.
export default async function run(page, ui) {
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
    document.querySelector('.datum-menu-label[data-menu-id="tools"]')?.click();
  });
  await wait(250);

  // Force the submenu open by adding the open class to the submenu row.
  const found = await page.evaluate(() => {
    const row = document.querySelector(
      ".datum-menu-panel-tools .datum-menu-item-submenu",
    );
    if (!row) return { found: false };
    row.classList.add("datum-menu-item-submenu-open");
    const sub = row.querySelector(".datum-menu-subpanel");
    return {
      found: true,
      rowLabel: row.querySelector(".datum-menu-item-label")?.textContent,
      subpanelBg: sub ? getComputedStyle(sub).backgroundColor : null,
      subpanelBorder: sub ? getComputedStyle(sub).borderColor : null,
      subpanelDisplay: sub ? getComputedStyle(sub).display : null,
      subItemBg: sub?.querySelector(".datum-menu-item")
        ? getComputedStyle(sub.querySelector(".datum-menu-item"))
            .backgroundColor
        : null,
    };
  });
  await wait(200);

  const panel = await page.evaluate(() => {
    const p = document.querySelector(".datum-menu-panel-tools");
    return { bg: getComputedStyle(p).backgroundColor };
  });

  return { theme, panel, submenu: found };
}

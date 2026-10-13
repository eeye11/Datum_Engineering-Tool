// Try candidate menu surfaces live and screenshot each, to choose empirically.
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

  const variant = process.env.VARIANT || "raised";
  await page.evaluate((v) => {
    const root = document.documentElement;
    if (v === "raised") root.style.setProperty("--datum-menu", "#ffffff");
    if (v === "mint") root.style.setProperty("--datum-menu", "#DDEBE9");
    document.querySelector('.datum-menu-label[data-menu-id="tools"]')?.click();
  }, variant);
  await wait(300);

  return await page.evaluate(() => {
    const p = document.querySelector(".datum-menu-panel-tools");
    return { bg: getComputedStyle(p).backgroundColor };
  });
}

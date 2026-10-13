// Final verification: Tools and Help, light and dark, with the height cap in
// place from the real source. Reports box + surface, and screenshots each.
export default async function run(page) {
  const wait = (ms) => page.waitForTimeout(ms);
  const theme = process.env.THEME || "light";
  const menuId = process.env.MENU || "tools";

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
  await wait(400);
  await page.evaluate((id) => {
    document.querySelector(`.datum-menu-label[data-menu-id="${id}"]`)?.click();
  }, menuId);
  await wait(300);

  return await page.evaluate((id) => {
    const p = document.querySelector(`.datum-menu-panel-${id}`);
    const r = p.getBoundingClientRect();
    const cs = getComputedStyle(p);
    return {
      id,
      box: {
        x: Math.round(r.x),
        y: Math.round(r.y),
        w: Math.round(r.width),
        h: Math.round(r.height),
      },
      bg: cs.backgroundColor,
      maxHeight: cs.maxHeight,
      overflowY: cs.overflowY,
      scrollHeight: p.scrollHeight,
      clientHeight: p.clientHeight,
      isScrollable: p.scrollHeight > p.clientHeight,
      itemCount: p.querySelectorAll(".datum-menu-item").length,
    };
  }, menuId);
}

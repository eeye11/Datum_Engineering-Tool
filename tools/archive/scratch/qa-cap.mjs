// Test: does capping the menu height (+ scroll) turn the slab into a dropdown?
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

    const s = document.createElement("style");
    s.id = "cap-test";
    s.textContent = `
      .datum-menu-panel { max-height: 320px; overflow-y: auto; }
    `;
    document.head.appendChild(s);
  });
  await wait(300);
  await page.evaluate(() => {
    document.querySelector('.datum-menu-label[data-menu-id="tools"]')?.click();
  });
  await wait(300);

  return await page.evaluate(() => {
    const p = document.querySelector(".datum-menu-panel-tools");
    const r = p.getBoundingClientRect();
    return {
      h: Math.round(r.height),
      w: Math.round(r.width),
      scrollHeight: p.scrollHeight,
      overflowY: getComputedStyle(p).overflowY,
      maxHeight: getComputedStyle(p).maxHeight,
      bg: getComputedStyle(p).backgroundColor,
    };
  });
}

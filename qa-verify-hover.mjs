// Real pointer hover + keyboard focus on a menu row, reporting computed styles.
export default async function run(page) {
  const wait = (ms) => page.waitForTimeout(ms);
  const res = {};

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
  await wait(300);

  await page.evaluate(() => {
    document.querySelector('.datum-menu-label[data-menu-id="tools"]')?.click();
  });
  await wait(250);

  const panelBg = await page.evaluate(
    () =>
      getComputedStyle(document.querySelector(".datum-menu-panel-tools"))
        .backgroundColor,
  );
  const restItem = await page.evaluate(() => {
    const i = document.querySelector('.datum-menu-item[data-menu-item="move"]');
    const cs = getComputedStyle(i);
    return { bg: cs.backgroundColor, color: cs.color };
  });

  // Real hover via Playwright.
  const box = await page.evaluate(() => {
    const i = document.querySelector('.datum-menu-item[data-menu-item="move"]');
    const r = i.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await page.mouse.move(box.x, box.y);
  await wait(250);

  const hoveredItem = await page.evaluate(() => {
    const i = document.querySelector('.datum-menu-item[data-menu-item="move"]');
    const cs = getComputedStyle(i);
    const icon = i.querySelector(".datum-menu-item-icon");
    return {
      bg: cs.backgroundColor,
      color: cs.color,
      iconColor: icon ? getComputedStyle(icon).color : null,
    };
  });
  const panelAfterHover = await page.evaluate(
    () =>
      getComputedStyle(document.querySelector(".datum-menu-panel-tools"))
        .backgroundColor,
  );

  // Keyboard focus on a row.
  await page.evaluate(() => {
    const i = document.querySelector(
      '.datum-menu-item[data-menu-item="rotate"]',
    );
    i.focus();
  });
  await wait(150);
  const focusedItem = await page.evaluate(() => {
    const i = document.querySelector(
      '.datum-menu-item[data-menu-item="rotate"]',
    );
    const cs = getComputedStyle(i);
    return {
      outline: cs.outlineColor + " " + cs.outlineWidth,
      outlineStyle: cs.outlineStyle,
    };
  });

  res.light = { panelBg, restItem, hoveredItem, panelAfterHover, focusedItem };

  // Repeat quickly in dark for the hover colour.
  await page.evaluate(() =>
    document.documentElement.setAttribute("data-theme", "dark"),
  );
  await wait(250);
  const darkHover = await page.evaluate(() => {
    const i = document.querySelector('.datum-menu-item[data-menu-item="move"]');
    return {
      bg: getComputedStyle(i).backgroundColor,
      color: getComputedStyle(i).color,
    };
  });
  res.dark = { hoveredItem: darkHover };

  return res;
}

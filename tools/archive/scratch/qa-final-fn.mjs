// Verify all menus after the cap: box sizes, scroll where needed, submenu, and
// that unrelated panels keep their own surfaces.
export default async function run(page) {
  const wait = (ms) => page.waitForTimeout(ms);
  const res = { menus: {} };

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

  for (const id of ["file", "edit", "insert", "view", "tools", "help"]) {
    await page.evaluate(() =>
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })),
    );
    await wait(80);
    await page.evaluate((i) => {
      document.querySelector(`.datum-menu-label[data-menu-id="${i}"]`)?.click();
    }, id);
    await wait(150);
    res.menus[id] = await page.evaluate((i) => {
      const p = document.querySelector(`.datum-menu-panel-${i}`);
      if (!p) return { open: false };
      const r = p.getBoundingClientRect();
      const cs = getComputedStyle(p);
      return {
        open: true,
        h: Math.round(r.height),
        w: Math.round(r.width),
        bg: cs.backgroundColor,
        scrollable: p.scrollHeight > p.clientHeight,
        items: p.querySelectorAll(".datum-menu-item").length,
      };
    }, id);
  }

  // Submenu still opens and shares the surface.
  await page.evaluate(() =>
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })),
  );
  await wait(80);
  await page.evaluate(() => {
    document.querySelector('.datum-menu-label[data-menu-id="file"]')?.click();
  });
  await wait(200);
  res.submenu = await page.evaluate(() => {
    const row = document.querySelector(
      ".datum-menu-panel-file .datum-menu-item-submenu",
    );
    if (!row) return { found: false };
    row.classList.add("datum-menu-item-submenu-open");
    const sub = row.querySelector(".datum-menu-subpanel");
    const r = sub.getBoundingClientRect();
    return {
      found: true,
      subBg: getComputedStyle(sub).backgroundColor,
      subW: Math.round(r.width),
      subH: Math.round(r.height),
      overflowY: getComputedStyle(sub).overflowY,
    };
  });

  // Non-menu surfaces unchanged.
  res.panels = await page.evaluate(() => {
    const g = (sel) => {
      const e = document.querySelector(sel);
      return e ? getComputedStyle(e).backgroundColor : null;
    };
    return {
      statusBar: g(".drawing-status-bar"),
      sheetBar: g(".drawing-sheet-bar-row"),
      toolbar: g(".drawing-toolbar"),
      workspace: g(".drawing-workspace"),
    };
  });

  // Escape / click-away still close.
  await page.evaluate(() =>
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })),
  );
  await wait(150);
  res.escapeCloses = !(await page.evaluate(
    () => !!document.querySelector(".datum-menu-panel"),
  ));

  return res;
}

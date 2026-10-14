// Functional + regression checks:
//  - open/close, click-away, Escape
//  - running a Help command opens the help dialog (proves actions still wired)
//  - File/Edit/Insert/View menus still open and share the same panel surface
//  - a NON-menu floating panel (drawing context menu) is unchanged
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

  const clickLabel = (id) =>
    page.evaluate((i) => {
      document.querySelector(`.datum-menu-label[data-menu-id="${i}"]`)?.click();
    }, id);

  // 1. Every menu opens and its panel shares the same surface.
  res.menus = {};
  for (const id of ["file", "edit", "insert", "view", "tools", "help"]) {
    await page.evaluate(() =>
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })),
    );
    await wait(80);
    await clickLabel(id);
    await wait(150);
    res.menus[id] = await page.evaluate((i) => {
      const p = document.querySelector(`.datum-menu-panel-${i}`);
      if (!p) return { open: false };
      const items = [...p.querySelectorAll(".datum-menu-item")];
      return {
        open: true,
        bg: getComputedStyle(p).backgroundColor,
        itemCount: items.length,
        ariaRole: p.getAttribute("role"),
        label: p.getAttribute("aria-label"),
      };
    }, id);
  }

  // 2. Escape closes.
  await page.evaluate(() =>
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })),
  );
  await wait(150);
  res.escapeCloses = !(await page.evaluate(
    () => !!document.querySelector(".datum-menu-panel"),
  ));

  // 3. Click-away closes.
  await clickLabel("help");
  await wait(150);
  const openedForClickAway = await page.evaluate(
    () => !!document.querySelector(".datum-menu-panel"),
  );
  await page.mouse.click(900, 500);
  await wait(200);
  res.clickAwayCloses =
    openedForClickAway &&
    !(await page.evaluate(() => !!document.querySelector(".datum-menu-panel")));

  // 4. Running a Help command still works: click "About DAETUM" and see a dialog.
  await clickLabel("help");
  await wait(150);
  await page.evaluate(() => {
    const item = [
      ...document.querySelectorAll(".datum-menu-panel-help .datum-menu-item"),
    ].find((b) => /about daetum/i.test(b.textContent || ""));
    item?.click();
  });
  await wait(300);
  res.helpCommandRan = await page.evaluate(() => {
    const dlg =
      document.querySelector('[role="dialog"]') ||
      document.querySelector(".datum-help-dialog") ||
      document.querySelector(".datum-settings-dialog");
    return {
      dialogPresent: !!dlg,
      dialogLabel: dlg?.getAttribute("aria-label") || dlg?.className || null,
      menuClosed: !document.querySelector(".datum-menu-panel"),
    };
  });
  // Close the dialog.
  await page.evaluate(() => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  });
  await wait(200);

  // 5. A non-menu floating panel: the drawing context menu must be untouched.
  res.contextMenuUntouched = await page.evaluate(() => {
    const el = document.createElement("div");
    el.className = "drawing-context-menu";
    el.style.position = "fixed";
    document.body.appendChild(el);
    const cs = getComputedStyle(el);
    const out = {
      bg: cs.backgroundColor,
      border: cs.borderColor,
      radius: cs.borderTopLeftRadius,
    };
    el.remove();
    return out;
  });

  return res;
}

/*
 * QA the LIGHT-MODE contrast of the Tools and Help menu subpanels.
 *
 * The defect: `.datum-menu-subpanel` carried geometry but no surface, so a nested
 * submenu drew its rows straight onto the page behind it. In light mode the labels
 * sat on the same pale background as the drawing with no panel of their own, which
 * is the low-contrast read that was reported.
 *
 * This opens each menu that has a nested panel, opens the nested panel, and reads
 * the COMPUTED background of both. A transparent background on the subpanel is the
 * defect; a real surface colour is the fix.
 */
export default async function run(page) {
  const errs = [];

  page.on("pageerror", (e) =>
    errs.push("PAGEERROR: " + e.message.slice(0, 220)),
  );
  page.on("console", (m) => {
    if (m.type() === "error") errs.push("CONSOLE: " + m.text().slice(0, 180));
  });

  const out = { errs };

  await page.evaluate(async () => {
    await import("/src/main.js");
  });
  await page.waitForTimeout(900);

  /* Force the LIGHT theme, which is where the report came from. */
  out.theme = await page.evaluate(async () => {
    const mod = await import("/src/editor/theme.js").catch(() => null);

    const root = document.documentElement;

    if (mod && (mod.setThemePreference || mod.applyTheme)) {
      (mod.setThemePreference || mod.applyTheme)("light");
    }

    /* A direct attribute write as a fallback, so the tokens are light regardless. */
    root.setAttribute("data-theme", "light");

    return root.getAttribute("data-theme");
  });

  await page.waitForTimeout(300);

  /*
   * The menu bar is built by the application into `#datumMenuBar`; the top-level
   * items are buttons there. Read them, then open the one whose label is Tools or
   * Help and inspect its nested subpanel.
   */
  out.menus = await page.evaluate(() => {
    const bar = document.querySelector("#datumMenuBar");

    if (!bar) {
      return [{ bar: false }];
    }

    const topButtons = Array.from(bar.querySelectorAll("button"));

    const results = [];

    for (const wanted of ["Tools", "Help"]) {
      const button = topButtons.find(
        (b) => (b.textContent || "").trim() === wanted,
      );

      if (!button) {
        results.push({ label: wanted, found: false });
        continue;
      }

      /* Open the menu the way the application does - a real click. */
      button.click();

      const panel = document.querySelector(".datum-menu-panel");

      if (!panel) {
        results.push({ label: wanted, found: true, panel: false });
        button.click();
        continue;
      }

      const panelStyles = getComputedStyle(panel);

      const items = Array.from(panel.querySelectorAll(".datum-menu-item"));

      const row = panel.querySelector(".datum-menu-item-submenu");

      const base = {
        label: wanted,
        found: true,
        panelBackground: panelStyles.backgroundColor,
        /* The first few item labels and their colours, which is what is read. */
        items: items.slice(0, 4).map((item) => ({
          text: (item.textContent || "").trim().slice(0, 24),
          colour: getComputedStyle(item).color,
          background: getComputedStyle(item).backgroundColor,
        })),
      };

      if (!row) {
        results.push({ ...base, submenu: false });
        button.click();
        continue;
      }

      /* Open the nested panel the way a pointer would. */
      row.classList.add("datum-menu-item-submenu-open");

      const sub = row.querySelector(".datum-menu-subpanel");

      if (!sub) {
        results.push({ ...base, submenu: true, subpanel: false });
        button.click();
        continue;
      }

      const styles = getComputedStyle(sub);
      const item = sub.querySelector(".datum-menu-item");

      results.push({
        ...base,
        submenu: true,
        subpanel: true,
        background: styles.backgroundColor,
        borderWidth: styles.borderTopWidth,
        padding: styles.paddingTop,
        itemColour: item ? getComputedStyle(item).color : null,
      });

      /* Close it again before the next one. */
      button.click();
    }

    return results;
  });

  return out;
}

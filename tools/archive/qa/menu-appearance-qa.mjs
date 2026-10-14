/*
 * QA the APPEARANCE of the Tools and Help dropdowns, in both themes.
 *
 * The complaint is not readability - it is that the dropdowns look like plain
 * white rectangles. So this reads the things that MAKE a floating menu read as
 * one: the panel's own surface against the menu bar above it, its border, radius
 * and shadow, and the item hover surface. A panel whose background equals the
 * bar's is the defect, because then nothing distinguishes it but a faint border.
 *
 * The comparison surface is the Features panel and a settings-style panel, so the
 * menu can be judged against the interface it belongs to rather than in isolation.
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

  const probe = (theme) =>
    page.evaluate(async (want) => {
      const root = document.documentElement;
      root.setAttribute("data-theme", want);

      /* Let the theme settle before reading computed styles. */
      await new Promise((r) => requestAnimationFrame(r));
      await new Promise((r) => requestAnimationFrame(r));

      const bar = document.querySelector("#datumMenuBar");
      const buttons = bar ? Array.from(bar.querySelectorAll("button")) : [];

      const readPanel = (label) => {
        const button = buttons.find(
          (b) => (b.textContent || "").trim() === label,
        );

        if (!button) {
          return { label, found: false };
        }

        button.click();

        const panel = document.querySelector(".datum-menu-panel");

        if (!panel) {
          button.click();
          return { label, found: true, panel: false };
        }

        const ps = getComputedStyle(panel);

        const items = Array.from(panel.querySelectorAll(".datum-menu-item"));

        /* A hovered item's surface, read by asking what the hover rule yields. */
        const hoverSurface = (() => {
          const css = getComputedStyle(items[0] || panel);
          return css.getPropertyValue("--datum-menu-hover").trim();
        })();

        const result = {
          label,
          found: true,
          panel: true,
          background: ps.backgroundColor,
          border: ps.borderTopWidth + " " + ps.borderTopColor,
          radius: ps.borderTopLeftRadius,
          shadow: ps.boxShadow.slice(0, 60),
          padding: ps.paddingTop,
          itemCount: items.length,
          firstItem: items[0]
            ? {
                text: (items[0].textContent || "").trim().slice(0, 20),
                colour: getComputedStyle(items[0]).color,
                background: getComputedStyle(items[0]).backgroundColor,
              }
            : null,
          separators: panel.querySelectorAll(".datum-menu-separator").length,
          hoverTokenResolved: hoverSurface,
        };

        button.click();

        return result;
      };

      /* The bar and a neighbouring panel, for the surface comparison. */
      const barStyle = bar ? getComputedStyle(bar) : null;

      const features = document.querySelector("#drawingProperties");

      return {
        theme: root.getAttribute("data-theme"),
        menuBarBackground: barStyle ? barStyle.backgroundColor : null,
        featuresBackground: features
          ? getComputedStyle(features).backgroundColor
          : null,
        tools: readPanel("Tools"),
        help: readPanel("Help"),
        /* The tokens themselves, which is where the surface step is decided. */
        tokens: {
          chrome: getComputedStyle(root)
            .getPropertyValue("--datum-chrome")
            .trim(),
          menu: getComputedStyle(root).getPropertyValue("--datum-menu").trim(),
          surface: getComputedStyle(root)
            .getPropertyValue("--datum-surface")
            .trim(),
          raised: getComputedStyle(root)
            .getPropertyValue("--datum-raised")
            .trim(),
          borderStrong: getComputedStyle(root)
            .getPropertyValue("--datum-border-strong")
            .trim(),
        },
      };
    }, theme);

  out.light = await probe("light");
  out.dark = await probe("dark");

  /* Switch back without a reload, to prove the theme change is immediate. */
  out.switched = await page.evaluate(async () => {
    const root = document.documentElement;

    root.setAttribute("data-theme", "light");

    await new Promise((r) => requestAnimationFrame(r));

    const afterLight = getComputedStyle(root)
      .getPropertyValue("--datum-menu")
      .trim();

    root.setAttribute("data-theme", "dark");

    await new Promise((r) => requestAnimationFrame(r));

    const afterDark = getComputedStyle(root)
      .getPropertyValue("--datum-menu")
      .trim();

    return { afterLight, afterDark };
  });

  return out;
}

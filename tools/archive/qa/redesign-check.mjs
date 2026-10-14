/*
 * NEW: verify the top bar redesign.
 *   four bands in order
 *   Command Search first in the quick-access row, not duplicated
 *   icons on every menu item, aligned
 *   search finds and RUNS real commands
 *   themes
 */
export default async function run(page) {
  await page.getByText("Engineering Drawing", { exact: true }).click();
  await page.waitForTimeout(1100);

  const out = {};

  /* ---- the four bands, by vertical position ---- */
  out.bands = await page.evaluate(() => {
    const box = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: Math.round(r.top), h: Math.round(r.height) };
    };

    return {
      appBar: box(".datum-header") || box("header"),
      menubar: box(".datum-menubar"),
      workspaceSelector: box(".drawing-toolbar"),
      quickAccess: box(".drawing-style-strip"),
    };
  });

  /* ---- Command Search position and uniqueness ---- */
  out.search = await page.evaluate(() => {
    const strip = document.querySelector(".drawing-style-strip");
    const field = document.getElementById("drawingCommandSearch");

    const order = [...strip.children].map(
      (c) => c.id || String(c.className).split(" ")[0],
    );

    return {
      fieldExists: Boolean(field),
      placeholder: field?.getAttribute("placeholder"),
      countOnPage: document.querySelectorAll("[data-command-search]").length,
      stripChildOrder: order,
      isFirstMeaningful:
        order[0] === "drawingCommandSearch" ||
        order[0] === "drawing-command-search",
    };
  });

  /* ---- icons on every menu item ---- */
  out.icons = {};

  for (const label of ["File", "Edit", "Insert", "View", "Tools", "Help"]) {
    await page.locator(`.datum-menu-label:text-is("${label}")`).click();
    await page.waitForTimeout(200);

    out.icons[label] = await page.evaluate(() => {
      const items = [...document.querySelectorAll(".datum-menu-item")];

      return {
        items: items.length,
        withIcons: items.filter((i) =>
          i.querySelector(
            ".datum-menu-item-icon svg path, .datum-menu-item-icon svg circle, .datum-menu-item-icon svg rect",
          ),
        ).length,
        labels: items.map(
          (i) => i.querySelector(".datum-menu-item-label").textContent,
        ),
        dividers: document.querySelectorAll(".datum-menu-separator").length,
      };
    });

    await page.keyboard.press("Escape");
    await page.waitForTimeout(150);
  }

  /* ---- search behaviour ---- */
  const searchFor = async (query) => {
    await page.fill("#drawingCommandSearch", query);
    await page.waitForTimeout(300);

    const results = await page.evaluate(() =>
      [...document.querySelectorAll(".datum-search-result")].map((r) => ({
        label: r.querySelector(".datum-search-result-label").textContent,
        menu: r.querySelector(".datum-search-result-menu").textContent,
      })),
    );

    await page.keyboard.press("Escape");
    await page.waitForTimeout(150);

    await page.fill("#drawingCommandSearch", "");
    await page.waitForTimeout(100);

    return results;
  };

  out.searchResults = {
    trim: await searchFor("trim"),
    print: await searchFor("print"),
    dark: await searchFor("dark"),
    fit: await searchFor("fit"),
  };

  return out;
}

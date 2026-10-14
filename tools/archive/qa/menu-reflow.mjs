/*
 * Does opening a menu MOVE anything?
 *
 * Takes the geometry of the rows and the canvas with every menu closed, then
 * with each menu open, and compares. A menu that reflows the page would show up
 * as a changed top or height.
 */
export default async function run(page) {
  await page.getByText("Engineering Drawing", { exact: true }).click();
  await page.waitForTimeout(900);

  const layout = () =>
    page.evaluate(() => {
      const box = (sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { top: Math.round(r.top), h: Math.round(r.height) };
      };

      return {
        menubar: box(".datum-menubar"),
        toolbar: box(".drawing-app-toolbar"),
        nav: box(".drawing-toolbar"),
        strip: box(".drawing-style-strip"),
        canvas: box(".drawing-canvas"),
      };
    });

  const closed = await layout();

  const opened = {};

  for (const label of ["File", "Edit", "View"]) {
    await page.locator(`.datum-menu-label:text-is("${label}")`).click();
    await page.waitForTimeout(220);

    opened[label] = {
      layout: await layout(),
      panelBox: await page.evaluate(() => {
        const p = document.querySelector(".datum-menu-panel");
        if (!p) return null;
        const r = p.getBoundingClientRect();
        return {
          top: Math.round(r.top),
          left: Math.round(r.left),
          w: Math.round(r.width),
          h: Math.round(r.height),
        };
      }),
    };

    await page.keyboard.press("Escape");
    await page.waitForTimeout(180);
  }

  /* Compare each open layout against the closed one. */
  const differences = {};

  for (const [label, data] of Object.entries(opened)) {
    differences[label] = Object.keys(closed).filter((key) => {
      const a = closed[key];
      const b = data.layout[key];
      return !a || !b || a.top !== b.top || a.h !== b.h;
    });
  }

  return {
    closed,
    differences,
    panels: Object.fromEntries(
      Object.entries(opened).map(([k, v]) => [k, v.panelBox]),
    ),
  };
}

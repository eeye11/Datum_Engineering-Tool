/*
 * WHY IS THE FIRST ROW CLIPPED?
 *
 * Reports, for the menu bar and the global tool bar, their own width against the
 * width available to the workspace, and each toolbar group's width. That answers
 * "is it too wide, and by how much" rather than guessing.
 */
export default async function run(page) {
  await page.getByText("Engineering Drawing", { exact: true }).click();
  await page.waitForTimeout(900);

  return page.evaluate(() => {
    const bar = document.querySelector(".drawing-app-toolbar");
    const row = document.querySelector(".drawing-menu-row");
    const ws = document.querySelector(".drawing-workspace");

    const width = (el) =>
      el ? Math.round(el.getBoundingClientRect().width) : null;

    const groups = [...bar.querySelectorAll(".drawing-app-toolbar-group")].map(
      (g) => ({
        label: g.getAttribute("aria-label"),
        w: Math.round(g.getBoundingClientRect().width),
      }),
    );

    const overflow = bar.scrollWidth - bar.clientWidth;

    return {
      workspaceWidth: width(ws),
      rowWidth: width(row),
      barWidth: width(bar),
      barScrollWidth: bar.scrollWidth,
      barClientWidth: bar.clientWidth,
      overflowPx: overflow,
      barOverflowX: getComputedStyle(bar).overflowX,
      menubarWidth: width(document.querySelector(".datum-menubar")),
      groups,
      totalGroupWidth: groups.reduce((sum, g) => sum + g.w, 0),
    };
  });
}

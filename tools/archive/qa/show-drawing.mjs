/* Open the Drawing tab and report the first row, ready for a screenshot. */
export default async function run(page) {
  await page.getByText("Engineering Drawing", { exact: true }).click();
  await page.waitForTimeout(1200);

  return page.evaluate(() => {
    const row = document.querySelector(".drawing-menu-row");
    const bar = document.querySelector(".drawing-app-toolbar");

    return {
      menuRowChildren: row
        ? [...row.children].map(
            (c) =>
              String(c.className || c.id || c.tagName).slice(0, 40) +
              " :: " +
              (c.textContent || "").replace(/\s+/g, " ").trim().slice(0, 70),
          )
        : null,
      toolbarGroupLabels: [
        ...document.querySelectorAll(".drawing-app-toolbar-group-label"),
      ].length,
      menuLabels: [...document.querySelectorAll(".datum-menu-label")].map(
        (l) => l.textContent,
      ),
      styleStripPresent: Boolean(
        document.querySelector(".drawing-style-strip"),
      ),
      styleStripTop: Math.round(
        document.querySelector(".drawing-style-strip")?.getBoundingClientRect()
          .top ?? -1,
      ),
    };
  });
}

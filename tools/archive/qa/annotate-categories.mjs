/*
 * Verify the re-categorised Annotate section:
 *  - the seven categories appear in order, tools directly under each
 *  - no submenu, no caret, no popup attribute
 *  - compact icon-only mode keeps the structure (dividers, order)
 */
export default async function run(page) {
  const errs = [];
  page.on("pageerror", (e) => errs.push("PAGEERROR: " + e.message.slice(0, 220)));
  page.on("console", (m) => {
    if (m.type() === "error") errs.push("CONSOLE: " + m.text().slice(0, 180));
  });

  await page.evaluate(async () => {
    await import("/src/main.js");
  });
  await page.waitForFunction(
    () => !!(window.enggDrawing && window.enggDrawing.state),
    { timeout: 15000 },
  );

  const tab = page
    .locator("button", { hasText: "Engineering Drawing" })
    .first();
  if (await tab.count()) await tab.click();
  await page.waitForTimeout(1000);

  await page.locator('button[data-category="ANNOTATE"]').click();
  await page.waitForTimeout(400);

  const readStructure = () =>
    page.evaluate(() => {
      const list = document.querySelector("#drawingToolList");
      return [...list.querySelectorAll(".drawing-tool-group")].map((g) => ({
        category: g
          .querySelector(".drawing-tool-group-label")
          ?.textContent?.trim(),
        tools: [...g.querySelectorAll(".drawing-tool")].map((b) => ({
          id: b.dataset.toolId,
          caret: !!b.querySelector(".drawing-tool-caret"),
          popup: b.getAttribute("aria-haspopup"),
        })),
      }));
    });

  const out = { errs };

  out.wide = await readStructure();
  out.headingWide = await page
    .locator("#drawingToolHeading")
    .textContent();

  // Compact icon-only: shrink the viewport into the icon-only breakpoint.
  await page.setViewportSize({ width: 600, height: 800 });
  await page.waitForTimeout(500);

  out.compact = await page.evaluate(() => {
    const list = document.querySelector("#drawingToolList");
    const groups = [...list.querySelectorAll(".drawing-tool-group")];
    const heading = document.querySelector("#drawingToolHeading");

    const visible = (el) =>
      !!(el && el.offsetParent !== null && el.getBoundingClientRect().width > 0);

    return {
      headingVisible: visible(heading),
      categoryLabelsVisible: groups.filter((g) =>
        visible(g.querySelector(".drawing-tool-group-label")),
      ).length,
      toolLabelsVisible: [...document.querySelectorAll(".drawing-tool-label")]
        .filter(visible).length,
      toolIconsVisible: [...document.querySelectorAll(".drawing-tool-icon")]
        .filter(visible).length,
      // Each group must keep a visible divider between categories.
      groupSeparators: groups.filter((g) => {
        const style = getComputedStyle(g);
        return (
          style.borderBottomWidth !== "0px" ||
          g === groups[groups.length - 1]
        );
      }).length,
      order: groups.map((g) =>
        [...g.querySelectorAll(".drawing-tool")].map(
          (b) => b.dataset.toolId,
        ),
      ),
    };
  });

  return out;
}

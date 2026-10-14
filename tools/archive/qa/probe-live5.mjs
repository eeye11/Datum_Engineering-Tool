/*
 * Live end-to-end: enter the drawing workspace and inventory the tools.
 */
export default async function run(page, ui) {
  const out = {};

  const tabs = await ui.snapshot();
  const drawTab = tabs.match(/@(e\d+) button "Engineering Drawing"/)?.[1];
  out.foundTab = drawTab || tabs.slice(0, 600);
  if (drawTab) {
    await ui.click(drawTab);
    await page.waitForTimeout(900);
  }

  out.workspaceVisible = await page.evaluate(() =>
    document.getElementById("drawing")?.classList.contains("active"),
  );

  const shelf = async (name) => {
    await page.evaluate((n) => {
      document
        .querySelector(`.drawing-category[data-category="${n}"]`)
        ?.click();
    }, name);
    await page.waitForTimeout(400);
    return page.evaluate(() =>
      Array.from(document.querySelectorAll("#drawingToolList [data-tool]")).map(
        (e) => ({
          tool: e.getAttribute("data-tool"),
          label: e.textContent.trim().replace(/\s+/g, " "),
        }),
      ),
    );
  };

  out.staticsTools = await shelf("STATICS");
  out.annotateTools = await shelf("ANNOTATE");
  out.geometryTools = await shelf("GEOMETRY");

  return out;
}

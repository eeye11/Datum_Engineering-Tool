/*
 * Live end-to-end: enter the drawing workspace and inventory the tools.
 */
export default async function run(page, ui) {
  const out = {};

  const tabs = await ui.snapshot();
  const drawTab = tabs.match(/@(e\d+) button "Engineering Drawing"/)?.[1];
  if (drawTab) {
    await ui.click(drawTab);
    await page.waitForTimeout(1000);
  }

  out.workspaceVisible = await page.evaluate(() =>
    document.getElementById("drawing")?.classList.contains("active"),
  );

  out.toolListHTML = await page.evaluate(() => {
    const list = document.getElementById("drawingToolList");
    return list ? list.outerHTML.slice(0, 1500) : "MISSING";
  });

  out.shelfButtons = await page.evaluate(() =>
    Array.from(document.querySelectorAll(".drawing-category")).map((b) =>
      b.getAttribute("data-category"),
    ),
  );

  await page.evaluate(() => {
    document
      .querySelector('.drawing-category[data-category="STATICS"]')
      ?.click();
  });
  await page.waitForTimeout(500);

  out.afterStatics = await page.evaluate(() => {
    const list = document.getElementById("drawingToolList");
    return list ? list.outerHTML.slice(0, 2000) : "MISSING";
  });

  return out;
}

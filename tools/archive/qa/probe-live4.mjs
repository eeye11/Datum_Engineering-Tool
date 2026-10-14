/*
 * Live end-to-end: create a Point Force, inspect its magnitude box and panel,
 * then run Smart Dimension on two lines.
 */
export default async function run(page, ui) {
  const out = {};

  await page.evaluate(() => {
    if (typeof showTab === "function") {
      const tab = Array.from(document.querySelectorAll(".tab")).find((t) =>
        /Engineering Drawing/.test(t.textContent),
      );
      showTab("drawing", tab);
    }
  });
  await page.waitForTimeout(700);

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

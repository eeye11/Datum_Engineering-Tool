/*
 * Live end-to-end verification against the real interaction layer.
 */
export default async function run(page, ui) {
  const out = {};

  const tab = (await ui.snapshot()).match(
    /@(e\d+) button "Engineering Drawing"/,
  )?.[1];
  if (tab) {
    await ui.click(tab);
    await page.waitForTimeout(900);
  }

  const shelf = async (name) => {
    await page.evaluate((n) => {
      document
        .querySelector(`.drawing-category[data-category="${n}"]`)
        ?.click();
    }, name);
    await page.waitForTimeout(300);
  };

  const tools = async () =>
    page.evaluate(() =>
      Array.from(
        document.querySelectorAll("#drawingToolList [data-tool-id]"),
      ).map((e) => ({
        id: e.getAttribute("data-tool-id"),
        label: (
          e.querySelector(".drawing-tool-label")?.textContent || ""
        ).trim(),
      })),
    );

  await shelf("STATICS");
  out.statics = await tools();
  await shelf("ANNOTATE");
  out.annotate = await tools();
  await shelf("GEOMETRY");
  out.geometry = await tools();

  return out;
}

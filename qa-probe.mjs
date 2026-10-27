export default async function run(page, ui) {
  return await page.evaluate(() => ({
    hasDrawingToolList: Boolean(document.getElementById("drawingToolList")),
    ids: [...document.querySelectorAll("[id^=drawing]")]
      .map((n) => n.id)
      .slice(0, 40),
    tabs: [...document.querySelectorAll(".tabs .tab, [data-tab]")]
      .map((n) => n.textContent.trim())
      .slice(0, 10),
  }));
}

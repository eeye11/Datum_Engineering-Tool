export default async function run(page, ui) {
  await page.waitForTimeout(1000);
  await page.evaluate(() => {
    [...document.querySelectorAll("button")]
      .find((b) => b.textContent.trim() === "Engineering Drawing")
      ?.click();
  });
  await page.waitForTimeout(900);

  const dom = await page.evaluate(() => {
    const out = {};
    out.categories = [...document.querySelectorAll(".drawing-category")].map(
      (el) => ({ cat: el.dataset.category, text: el.textContent.trim() }),
    );
    const list = document.querySelector("#drawingToolList");
    out.toolListHtml = list ? list.innerHTML.slice(0, 4000) : "none";
    out.toolButtons = [...document.querySelectorAll(".drawing-tool")].map(
      (b) => ({
        id: b.dataset.toolId,
        label: b.textContent.trim(),
      }),
    );
    return out;
  });
  return dom;
}

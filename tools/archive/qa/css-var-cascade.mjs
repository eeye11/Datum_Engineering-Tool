/*
 * Which declaration wins for the fill path? Compare the custom property and the
 * computed fill with what the rule says.
 */
export default async function run(page) {
  await page.getByRole("button", { name: "Engineering Drawing" }).click();
  await page.waitForTimeout(400);

  await page.evaluate(() => {
    const input = document.getElementById("drawingColor");
    input.value = "#e5bb50";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.waitForTimeout(200);

  return await page.evaluate(() => {
    const f = document.querySelector(".drawing-strip-icon-fill");
    const swatch = document.querySelector(".drawing-colour-swatch");

    /* Walk the chain and report the custom property AT EACH LEVEL. */
    const levels = [];
    let n = f;
    while (n && n !== document.body) {
      levels.push({
        el: n.tagName.toLowerCase() + "." + (n.getAttribute("class") || "-"),
        colourVar: getComputedStyle(n)
          .getPropertyValue("--datum-colour-value")
          .trim(),
      });
      n = n.parentElement;
    }

    return {
      swatchInlineVar:
        swatch?.style.getPropertyValue("--datum-colour-value").trim() ||
        "(none)",
      computedOnPath: getComputedStyle(f)
        .getPropertyValue("--datum-colour-value")
        .trim(),
      levels,
      fill: getComputedStyle(f).fill,
    };
  });
}

/*
 * Where is the fill path, and is the custom property reaching it?
 */
export default async function run(page) {
  await page.getByRole("button", { name: "Engineering Drawing" }).click();
  await page.waitForTimeout(500);

  await page.evaluate(() => {
    const input = document.getElementById("drawingColor");
    input.value = "#e5bb50";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.waitForTimeout(200);

  return await page.evaluate(() => {
    const f = document.querySelector(".drawing-strip-icon-fill");
    if (!f) return { found: false };

    const chain = [];
    let n = f;
    while (n && n !== document.body) {
      chain.push(
        `${n.tagName.toLowerCase()}.${n.getAttribute ? n.getAttribute("class") || "-" : "-"}`,
      );
      n = n.parentElement;
    }

    const swatch = document.querySelector(".drawing-colour-swatch");
    const cs = getComputedStyle(f);

    return {
      found: true,
      chain,
      swatchVar: swatch?.style.getPropertyValue("--datum-colour-value"),
      computedFill: cs.fill,
      inlineFill: f.style.fill || null,
      attrFill: f.getAttribute("fill"),
      matchedRules: f.getAttribute("class"),
    };
  });
}

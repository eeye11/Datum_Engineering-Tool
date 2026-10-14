/*
 * ========================================================
 * ACCEPTANCE TEST - TOP-LEVEL TAB TYPOGRAPHY
 * ========================================================
 *
 * "Written Solution" and "Engineering Drawing" are the two halves of the same
 * application, in the same bar. Neither may be set larger or smaller than the
 * other, or one looks like a different product.
 */

export default async function run(page) {
  await page.waitForFunction(() => typeof window.datum === "object", null, {
    timeout: 20000,
  });

  return page.evaluate(() => {
    const tabs = [...document.querySelectorAll(".tab")].map((tab) => {
      const style = getComputedStyle(tab);

      return {
        label: tab.textContent.trim(),
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        fontFamily: style.fontFamily,
        colour: style.color,
      };
    });

    const sizes = new Set(tabs.map((tab) => tab.fontSize));

    return {
      tabs,
      sameSize: sizes.size === 1,
      size: [...sizes],
    };
  });
}

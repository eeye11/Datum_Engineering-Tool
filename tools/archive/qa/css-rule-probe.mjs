/*
 * Which of the colour rules actually made it into the parsed stylesheet?
 */
export default async function run(page) {
  return await page.evaluate(() => {
    const ss = [...document.styleSheets].find(
      (s) => s.href && s.href.includes("editor.css"),
    );

    const selectors = [...ss.cssRules]
      .map((r) => r.selectorText || "")
      .filter(Boolean);

    return {
      total: selectors.length,
      swatch: selectors.filter((t) => t.includes("drawing-colour-swatch")),
      iconFill: selectors.filter((t) => t.includes("icon-fill")),
      stripColour: selectors.filter((t) => t.includes("drawing-strip-colour")),
      stripIcon: selectors.filter((t) => t.includes("drawing-strip-icon")),
    };
  });
}

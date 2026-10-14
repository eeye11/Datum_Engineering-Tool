/*
 * What the three property dropdowns actually look like when opened: compare the
 * select's computed metrics against the other controls' text.
 */
export default async function run(page) {
  await page.getByRole("button", { name: "Engineering Drawing" }).click();
  await page.waitForTimeout(400);

  return await page.evaluate(() => {
    const detail = (id) => {
      const el = document.getElementById(id);
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return {
        id,
        rect: [Math.round(r.width), Math.round(r.height)],
        font: `${cs.fontSize} / ${cs.lineHeight}`,
        padding: cs.padding,
        colorScheme: cs.colorScheme,
        appearance: cs.appearance,
        options: [...el.options].map((o) => o.textContent.trim()),
      };
    };

    /* What the STOCK text elsewhere in the strip uses, for comparison. */
    const vector = document.getElementById("drawingVectorScaleValue");
    const vcs = vector ? getComputedStyle(vector) : null;

    return {
      thickness: detail("drawingThickness"),
      lineType: detail("drawingLineType"),
      vectorScale: detail("drawingVectorScale"),
      vectorValueText: vcs
        ? { font: vcs.fontSize, weight: vcs.fontWeight }
        : null,
      rootColorScheme: getComputedStyle(document.documentElement).colorScheme,
    };
  });
}

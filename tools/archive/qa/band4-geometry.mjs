/*
 * Measure the icon-control wrappers and their overlaid selects, to find which
 * containing block each overlay is resolving against.
 */
export default async function run(page) {
  await page.getByRole("button", { name: "Engineering Drawing" }).click();
  await page.waitForTimeout(400);

  return await page.evaluate(() => {
    const r = (el) => {
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return [
        Math.round(b.x),
        Math.round(b.y),
        Math.round(b.width),
        Math.round(b.height),
      ];
    };

    const lt = document.getElementById("drawingLineType");
    const colour = document.getElementById("drawingColor");

    return {
      colourInput: r(colour),
      colourInputPos: colour ? getComputedStyle(colour).position : null,      swatch: r(document.querySelector(".drawing-colour-swatch")),
      colourControl: r(document.querySelector(".drawing-colour-control")),
      colourWrap: r(document.querySelector(".drawing-strip-colour")),
      ltSelect: r(lt),
      ltWrap: r(lt?.parentElement),
      grid: r(document.getElementById("drawingGridToggle")),
      snap: r(document.getElementById("drawingSnapToggle")),
      thicknessSelect: r(document.getElementById("drawingThickness")),
      vectorSelect: r(document.getElementById("drawingVectorScale")),
    };
  });
}

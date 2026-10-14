/*
 * Report the exact geometry of the thickness and line-type icons as rendered,
 * plus the dropdown option formatting - so the faults can be identified without
 * looking at a screenshot.
 */
export default async function run(page) {
  await page.getByRole("button", { name: "Engineering Drawing" }).click();
  await page.waitForTimeout(400);

  return await page.evaluate(() => {
    const info = (id) => {
      const host = document.getElementById(id);
      const svg = host?.querySelector("svg");
      const paths = svg ? [...svg.querySelectorAll("path")] : [];
      return {
        hostRect: (() => {
          const r = host.getBoundingClientRect();
          return [Math.round(r.width), Math.round(r.height)];
        })(),
        svgAttrs: svg
          ? {
              w: svg.getAttribute("width"),
              h: svg.getAttribute("height"),
              viewBox: svg.getAttribute("viewBox"),
            }
          : null,
        paths: paths.map((p) => ({
          d: p.getAttribute("d"),
          strokeWidth: p.getAttribute("stroke-width"),
          dash: p.getAttribute("stroke-dasharray"),
        })),
      };
    };

    const sel = (id) => {
      const el = document.getElementById(id);
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return {
        rect: [
          Math.round(r.x),
          Math.round(r.y),
          Math.round(r.width),
          Math.round(r.height),
        ],
        fontSize: cs.fontSize,
        opacity: cs.opacity,
        options: [...el.options].map((o) => o.textContent),
      };
    };

    return {
      thickness: info("drawingThicknessPreview"),
      lineType: info("drawingLineTypePreview"),
      thicknessSelect: sel("drawingThickness"),
      lineTypeSelect: sel("drawingLineType"),
      vectorSelect: sel("drawingVectorScale"),
    };
  });
}

/*
 * Measure the THREE property controls - thickness, colour, line type - and the
 * size of the icon inside each, so a size mismatch can be seen exactly.
 */
export default async function run(page) {
  await page.getByRole("button", { name: "Engineering Drawing" }).click();
  await page.waitForTimeout(400);

  return await page.evaluate(() => {
    const rows = [];

    document
      .querySelectorAll(".drawing-style-strip .drawing-strip-icon-control")
      .forEach((control) => {
        const cr = control.getBoundingClientRect();

        /* The icon host: thickness/line-type have one; colour has one too. */
        const hosts = [...control.querySelectorAll(".drawing-strip-icon")];
        const svgs = [...control.querySelectorAll("svg")];

        rows.push({
          controlWidth: Math.round(cr.width),
          controlHeight: Math.round(cr.height),
          hostCount: hosts.length,
          hostSizes: hosts.map((h) => {
            const r = h.getBoundingClientRect();
            const cs = getComputedStyle(h);
            return {
              id: h.id || "(colour)",
              w: Math.round(r.width),
              h: Math.round(r.height),
              border: cs.borderWidth,
              bg: cs.backgroundColor,
            };
          }),
          svgSizes: svgs.map((s) => {
            const r = s.getBoundingClientRect();
            return `${Math.round(r.width)}x${Math.round(r.height)}`;
          }),
          svgAttr: svgs.map(
            (s) => s.getAttribute("width") + "x" + s.getAttribute("height"),
          ),
        });
      });

    return rows;
  });
}

/*
 * Verify the three faults from the screenshot are gone:
 *   1. no permanent focus ring on the colour button at rest
 *   2. the three icons are the same size
 *   3. the row is aligned and evenly spaced
 */
export default async function run(page) {
  await page.getByRole("button", { name: "Engineering Drawing" }).click();

  /* The dev server can be slow to compile; wait for the strip to have a size. */
  await page.waitForFunction(
    () => {
      const strip = document.querySelector(".drawing-style-strip");
      return strip && strip.getBoundingClientRect().height > 0;
    },
    { timeout: 15000 },
  );

  await page.waitForTimeout(300);

  const data = await page.evaluate(() => {
    const controls = [
      ...document.querySelectorAll(".drawing-style-strip .drawing-strip-icon-control"),
    ];

    const icons = controls.map((c) => {
      const svg = c.querySelector("svg");
      const sr = svg ? svg.getBoundingClientRect() : null;
      const face = c.querySelector(".drawing-strip-icon");
      const fr = face ? face.getBoundingClientRect() : null;
      const cs = face ? getComputedStyle(face) : null;
      return {
        svg: sr ? Math.round(sr.width) + "x" + Math.round(sr.height) : null,
        face: fr ? Math.round(fr.width) + "x" + Math.round(fr.height) : null,
        border: cs ? cs.borderWidth : null,
        outline: cs ? cs.outlineWidth : null,
      };
    });

    /* Is the colour button showing a focus ring at rest? */
    const colour = document.querySelector(".drawing-strip-colour");
    const ccs = getComputedStyle(colour);
    const active = document.activeElement;

    return {
      icons,
      colourBorder: ccs.borderColor,
      colourOutline: ccs.outlineWidth + " " + ccs.outlineStyle,
      activeElement: active
        ? active.tagName.toLowerCase() + "#" + (active.id || "-")
        : "none",
      gaps: (() => {
        const strip = document.querySelector(".drawing-style-strip");
        const kids = [...strip.children];
        const out = [];
        for (let i = 1; i < kids.length; i += 1) {
          out.push(
            Math.round(
              kids[i].getBoundingClientRect().left -
                kids[i - 1].getBoundingClientRect().right,
            ),
          );
        }
        return out;
      })(),
      tops: [...document.querySelector(".drawing-style-strip").children].map((c) =>
        Math.round(c.getBoundingClientRect().top),
      ),
    };
  });

  return data;
}

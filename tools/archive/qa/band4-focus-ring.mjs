/*
 * Is a focus ring actually DRAWN at rest, and does it appear on keyboard focus?
 * The computed outline WIDTH is meaningless without its STYLE.
 */
export default async function run(page) {
  await page.getByRole("button", { name: "Engineering Drawing" }).click();
  await page.waitForTimeout(400);

  const ringOf = (el) => {
    const cs = getComputedStyle(el);
    return {
      style: cs.outlineStyle,
      width: cs.outlineWidth,
      colour: cs.outlineColor,
      borderColour: cs.borderColor,
    };
  };

  const atRest = await page.evaluate(() => {
    const faces = [
      ...document.querySelectorAll(
        ".drawing-style-strip .drawing-strip-icon-control .drawing-strip-icon",
      ),
    ];
    return faces.map((f) => {
      const cs = getComputedStyle(f);
      return {
        outlineStyle: cs.outlineStyle,
        outlineWidth: cs.outlineWidth,
        borderTop: cs.borderTopColor,
      };
    });
  });

  const colourAtRest = await page.evaluate(() => {
    const c = document.querySelector(".drawing-strip-colour");
    const cs = getComputedStyle(c);
    return {
      outlineStyle: cs.outlineStyle,
      borderColour: cs.borderColor,
    };
  });

  /* Now focus the thickness select by KEYBOARD and see the ring appear. */
  await page.evaluate(() => {
    document.getElementById("drawingThickness").focus();
  });
  await page.waitForTimeout(150);

  const focused = await page.evaluate(() => {
    const face = document
      .getElementById("drawingThickness")
      .closest(".drawing-strip-icon-control")
      .querySelector(".drawing-strip-icon");
    const cs = getComputedStyle(face);
    return { outlineStyle: cs.outlineStyle, outlineWidth: cs.outlineWidth };
  });

  return { atRest, colourAtRest, focused };
}

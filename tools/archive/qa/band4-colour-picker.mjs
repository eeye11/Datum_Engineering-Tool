/*
 * The colour swatch must OPEN THE PICKER when clicked, and the icon must be
 * present alongside it.
 */
export default async function run(page) {
  await page.getByRole("button", { name: "Engineering Drawing" }).click();
  await page.waitForTimeout(500);

  const before = await page.evaluate(() => ({
    popupOpen: document.querySelectorAll(".drawing-colour-popup").length,
    hasIcon: Boolean(
      document.querySelector(
        ".drawing-strip-colour svg, .drawing-strip-icon-control svg",
      ),
    ),
  }));

  /* Click the swatch - it is the control that opens the picker. */
  await page.locator("#drawingColourSwatch").click();
  await page.waitForTimeout(300);

  const after = await page.evaluate(() => {
    const popup = document.querySelector(".drawing-colour-popup");
    const r = popup?.getBoundingClientRect();
    return {
      popupOpen: document.querySelectorAll(".drawing-colour-popup").length,
      popupRect: r
        ? [
            Math.round(r.x),
            Math.round(r.y),
            Math.round(r.width),
            Math.round(r.height),
          ]
        : null,
      popupHasCells: popup
        ? popup.querySelectorAll(".drawing-colour-cell").length
        : 0,
    };
  });

  /* Click a colour cell and confirm the swatch takes it. */
  const cell = page.locator(".drawing-colour-cell").nth(6);
  await cell.click();
  await page.waitForTimeout(300);

  const picked = await page.evaluate(() => {
    const swatch = document.querySelector(".drawing-colour-swatch");
    return {
      inputValue: document.getElementById("drawingColor").value,
      swatchBg: getComputedStyle(swatch).backgroundColor,
      popupStillOpen: document.querySelectorAll(".drawing-colour-popup").length,
    };
  });

  return { before, after, picked };
}

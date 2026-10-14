/*
 * Verify the colour control: the icon is present, the swatch bar carries the
 * REAL drawing colour, and setting a new colour updates it.
 */
export default async function run(page) {
  await page.getByRole("button", { name: "Engineering Drawing" }).click();
  await page.waitForTimeout(500);

  const read = () =>
    page.evaluate(() => {
      const swatch = document.querySelector(".drawing-colour-swatch");
      const button = document.querySelector(".drawing-strip-colour");
      const icon = button?.querySelector("svg");
      const bs = swatch ? getComputedStyle(swatch) : null;
      const br = button?.getBoundingClientRect();
      const sr = swatch?.getBoundingClientRect();
      return {
        inputValue: document.getElementById("drawingColor").value,
        hasIcon: Boolean(icon),
        colourVar:
          swatch?.style.getPropertyValue("--datum-colour-value") || null,
        swatchHeight: sr ? Math.round(sr.height) : null,
        swatchWidth: sr ? Math.round(sr.width) : null,
        buttonHeight: br ? Math.round(br.height) : null,
        buttonWidth: br ? Math.round(br.width) : null,
        swatchPos: bs?.position,
      };
    });

  const before = await read();

  /* Set a new colour through the real input, as the picker does. */
  await page.evaluate(() => {
    const input = document.getElementById("drawingColor");
    input.value = "#16845b";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.waitForTimeout(250);

  const after = await read();

  return { before, after };
}

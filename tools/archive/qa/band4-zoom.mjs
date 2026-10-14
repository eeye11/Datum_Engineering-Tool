/*
 * Crop-style close-up: render just Band 4 at a large scale so the individual
 * icons can be inspected.
 */
export default async function run(page) {
  await page.getByRole("button", { name: "Engineering Drawing" }).click();
  await page.waitForTimeout(400);

  /* Zoom the page so the 17px icons are legible in the screenshot. */
  await page.evaluate(() => {
    document.body.style.zoom = "3";
  });
  await page.waitForTimeout(300);

  return await page.evaluate(() => {
    const strip = document.querySelector(".drawing-style-strip");
    const r = strip.getBoundingClientRect();
    return {
      stripRect: [
        Math.round(r.x),
        Math.round(r.y),
        Math.round(r.width),
        Math.round(r.height),
      ],
    };
  });
}

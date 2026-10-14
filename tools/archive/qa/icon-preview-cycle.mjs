/*
 * Set each line type and confirm the icon's three rules all take the pattern;
 * set each thickness and confirm the ladder rescales.
 */
export default async function run(page) {
  await page.getByRole("button", { name: "Engineering Drawing" }).click();
  await page.waitForTimeout(400);

  const readLineType = () =>
    page.evaluate(() =>
      [...document.querySelectorAll("#drawingLineTypePreview path")].map((p) =>
        p.getAttribute("stroke-dasharray"),
      ),
    );

  const readThickness = () =>
    page.evaluate(() =>
      [...document.querySelectorAll("#drawingThicknessPreview path")].map((p) =>
        p.getAttribute("stroke-width"),
      ),
    );

  const setSelect = async (id, value) => {
    await page.evaluate(
      ({ selId, val }) => {
        const el = document.getElementById(selId);
        el.value = val;
        el.dispatchEvent(new Event("change", { bubbles: true }));
      },
      { selId: id, val: value },
    );
    await page.waitForTimeout(150);
  };

  const lineTypes = {};
  for (const t of ["solid", "dashed", "center", "construction"]) {
    await setSelect("drawingLineType", t);
    lineTypes[t] = await readLineType();
  }

  const thicknesses = {};
  for (const w of ["0.25", "0.5", "0.75", "1"]) {
    await setSelect("drawingThickness", w);
    thicknesses[w] = await readThickness();
  }

  /* Restore the defaults. */
  await setSelect("drawingLineType", "solid");
  await setSelect("drawingThickness", "0.5");

  return { lineTypes, thicknesses };
}

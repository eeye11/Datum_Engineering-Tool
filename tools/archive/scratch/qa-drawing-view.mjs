export default async function run(page, ui) {
  // Open the Engineering Drawing view, which lazily loads the drawing modules.
  const snap = await ui.snapshot();
  const drawBtn = snap.match(/@(e\d+) button "Engineering Drawing"/)?.[1];

  if (!drawBtn) {
    return { error: "no Engineering Drawing button", snap };
  }

  await ui.click(drawBtn);
  await page.waitForTimeout(1500);

  const probe = await page.evaluate(() => ({
    meas: !!window.enggMeasurement,
    dimModel: !!window.enggDimensionModel,
    editor: !!window.enggDimensionEditor,
    quant: !!window.enggQuantities,
    smart: !!window.enggSmartDimension,
    dims: !!window.enggDimensions,
    canvas: !!document.querySelector("canvas"),
    dimensionTools: Array.from(document.querySelectorAll("[data-tool-id]"))
      .map((el) => el.getAttribute("data-tool-id"))
      .filter((id) => id && id.includes("dimension")),
  }));

  return { probe };
}

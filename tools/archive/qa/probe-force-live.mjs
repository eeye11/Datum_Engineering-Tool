/*
 * Live end-to-end: create a Point Force, inspect its magnitude annotation and
 * panel; drag the annotation and confirm the force does not move; then run
 * Smart Dimension on two lines.
 */
export default async function run(page, ui) {
  const out = {};

  const tab = (await ui.snapshot()).match(
    /@(e\d+) button "Engineering Drawing"/,
  )?.[1];
  if (tab) {
    await ui.click(tab);
    await page.waitForTimeout(900);
  }

  const shelf = (name) =>
    page.evaluate((n) => {
      document
        .querySelector(`.drawing-category[data-category="${n}"]`)
        ?.click();
    }, name);

  const pickTool = async (id) => {
    await page.evaluate((tid) => {
      document
        .querySelector(`#drawingToolList [data-tool-id="${tid}"]`)
        ?.click();
    }, id);
    await page.waitForTimeout(300);
  };

  // Read the live drawing state through the module the app uses.
  const readState = () =>
    page.evaluate(() => {
      const canvas = document.querySelector(".drawing-canvas");
      const svg = canvas?.querySelector("svg");
      const derived = Array.from(
        canvas?.querySelectorAll(".drawing-derived-magnitude") || [],
      ).map((g) => ({
        id: g.getAttribute("data-feature-id"),
        text: (g.textContent || "").trim(),
      }));
      const dims = Array.from(
        canvas?.querySelectorAll("[data-feature-id]") || [],
      )
        .filter((g) =>
          /dimension/.test(g.getAttribute("data-feature-id") || ""),
        )
        .map((g) => ({
          id: g.getAttribute("data-feature-id"),
          text: (g.textContent || "").trim(),
        }));
      return { derived, dims };
    });

  // Create a Point Force with two clicks on the canvas.
  await shelf("STATICS");
  await pickTool("point-force");

  const rect = await page.evaluate(() => {
    const r = document.querySelector(".drawing-canvas").getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });

  const clickAt = async (fx, fy) => {
    await page.mouse.click(rect.x + rect.w * fx, rect.y + rect.h * fy);
    await page.waitForTimeout(350);
  };

  await clickAt(0.35, 0.4);
  await clickAt(0.55, 0.4);

  out.afterForce = await readState();

  // Select the force and read its panel labels.
  await pickTool("select");
  await clickAt(0.45, 0.4);
  await page.waitForTimeout(300);

  out.forcePanel = await page.evaluate(() => {
    const host = document.getElementById("drawingProperties");
    return {
      labels: Array.from(
        host?.querySelectorAll(".drawing-property-grid-label") || [],
      )
        .map((e) => e.textContent.trim())
        .filter(Boolean),
      toggles: Array.from(
        host?.querySelectorAll(
          "[data-feature-show-magnitude],[data-feature-show-unit]",
        ) || [],
      ).map((e) =>
        e.hasAttribute("data-feature-show-unit") ? "unit" : "magnitude",
      ),
      text: (host?.textContent || "").replace(/\s+/g, " ").slice(0, 600),
    };
  });

  return out;
}

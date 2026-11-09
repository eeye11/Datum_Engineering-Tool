/*
 * A real-browser check of the full-canvas coordinate space: open Graph - Sketch,
 * read the mapping, draw a wobbly curve, add points, switch to manual bounds,
 * and look at what the canvas actually contains at two window sizes.
 */
export default async function run(page) {
  const log = [];

  /*
   * THE APP IS WAITED FOR BY WHAT IT SHOWS FIRST. The Math tools are only in the
   * list once their category is chosen, so waiting for Graph before pressing the
   * category waits for something that will never appear.
   */
  await page.waitForSelector(".drawing-category", { timeout: 120000 });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(500);

  await page
    .getByRole("button", { name: "MATH / ANALYSIS", exact: true })
    .click();

  await page.waitForSelector('#drawingToolList [data-tool-id="math-plot"]', {
    timeout: 30000,
  });

  await page
    .locator('#drawingToolList [data-tool-id="math-plot"]')
    .first()
    .click();
  await page.waitForTimeout(400);

  await page
    .locator('.drawing-coordinate-submenu [data-submenu-id="sketch"]')
    .first()
    .click();

  await page.waitForSelector(".drawing-graph-sketch [data-sketch-svg]", {
    timeout: 30000,
  });

  await page.waitForTimeout(500);

  const readState = () =>
    page.evaluate(() => {
      const dialog = document.querySelector(".drawing-graph-sketch");
      const stats = dialog.__datumSketch.stats();
      const canvas = dialog
        .querySelector(".sketch-canvas")
        .getBoundingClientRect();
      const svg = dialog.querySelector("[data-sketch-svg]");

      return {
        boundsMode: stats.boundsMode,
        limits: stats.limits,
        origin: {
          x: Math.round(stats.origin.x),
          y: Math.round(stats.origin.y),
        },
        mapping: {
          left: stats.mapping.left,
          right: Math.round(stats.mapping.right),
          top: stats.mapping.top,
          bottom: Math.round(stats.mapping.bottom),
        },
        canvas: { w: Math.round(canvas.width), h: Math.round(canvas.height) },
        viewBox: svg.getAttribute("viewBox"),
        axes: svg.querySelectorAll('[data-graph-part="axis"]').length,
        ticks: dialog.querySelectorAll('[data-label="tick"]').length,
        points: stats.points.length,
        strokes: stats.strokes.length,
        modeLabel: dialog.querySelector("[data-sketch-bounds-mode-label]")
          ?.textContent,
        fields: ["xMin", "xMax", "yMin", "yMax"].map(
          (key) => dialog.querySelector(`[data-sketch-field="${key}"]`)?.value,
        ),
      };
    });

  log.push("OPEN: " + JSON.stringify(await readState()));

  /* A wobbly horizontal stroke. */
  const box = await page
    .locator(".drawing-graph-sketch [data-sketch-svg]")
    .boundingBox();

  await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.4);
  await page.mouse.down();

  for (let step = 1; step <= 50; step += 1) {
    const t = step / 50;

    await page.mouse.move(
      box.x + box.width * (0.25 + 0.5 * t),
      box.y + box.height * 0.4 + Math.sin(t * Math.PI * 8) * 3,
    );
  }

  await page.mouse.up();
  await page.waitForTimeout(300);

  const afterStroke = await page.evaluate(() => {
    const dialog = document.querySelector(".drawing-graph-sketch");
    const stats = dialog.__datumSketch.stats();

    return {
      corrected: stats.corrected.map((entry) => entry.kind),
      correctedPoints: stats.corrected.map((entry) => entry.points.length),
      paths: dialog.querySelectorAll(".sketch-corrected-stroke").length,
      limits: stats.limits,
    };
  });

  log.push("STROKE: " + JSON.stringify(afterStroke));

  /* Two points, far apart, so the automatic range must grow. */
  await page.click(".drawing-graph-sketch [data-sketch-tool-point]");

  await page.mouse.click(box.x + box.width * 0.15, box.y + box.height * 0.8);
  await page.waitForTimeout(150);
  await page.mouse.click(box.x + box.width * 0.85, box.y + box.height * 0.2);
  await page.waitForTimeout(250);

  log.push("POINTS: " + JSON.stringify(await readState()));

  /* Manual bounds, typed. */
  const xMax = page.locator('.drawing-graph-sketch [data-sketch-field="xMax"]');

  await xMax.fill("6");
  await xMax.dispatchEvent("input");
  await page.waitForTimeout(300);

  log.push("MANUAL: " + JSON.stringify(await readState()));

  await page.screenshot({ path: "qa/bounds-manual.png" });

  /* Back to automatic. */
  await page.click('.drawing-graph-sketch [data-sketch-bounds-mode="auto"]');
  await page.waitForTimeout(300);

  log.push("AUTO AGAIN: " + JSON.stringify(await readState()));

  await page.screenshot({ path: "qa/bounds-auto.png" });

  /* A small window. */
  await page.setViewportSize({ width: 860, height: 620 });
  await page.waitForTimeout(600);

  log.push("NARROW: " + JSON.stringify(await readState()));

  await page.screenshot({ path: "qa/bounds-narrow.png" });

  return { log };
}

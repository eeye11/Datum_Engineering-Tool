/*
 * A real-browser check of the Graph - Sketch editor: open it, read the layout
 * at two window sizes, draw a wobbly curve and a wobbly line, and record what
 * the three views and the geometry actually contain.
 *
 * Run with the browser-automation skill:
 *
 *   node <skill>/browser.mjs http://localhost:5199/ --script ./qa/graph-sketch-qa.mjs
 */
export default async function run(page, ui) {
  const log = [];

  /*
   * THE APP IS WAITED FOR, NOT SLEPT THROUGH.
   *
   * The first paint of the full application takes tens of seconds on a cold,
   * loaded machine. A fixed sleep made every step race that, and a race reads
   * exactly like a broken editor - a dialog that never opened, a hook that was
   * "undefined". Waiting for the thing itself is both faster and honest.
   */
  await page.waitForSelector('#drawingToolList [data-tool-id="math-plot"]', {
    state: "attached",
    timeout: 90000,
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(500);

  /*
   * BY TEXT, NOT BY REF.
   *
   * A ref is stamped into the page by a snapshot and dies as soon as the page
   * re-renders - and the category buttons re-render on load. Naming the control
   * the way a student reads it is both stabler and closer to what the check is
   * about: the button that says MATH / ANALYSIS.
   */
  await page.getByRole("button", { name: "MATH / ANALYSIS", exact: true }).click();
  await page.waitForTimeout(300);

  /* The Graph tool, by the id the toolbar gives it. */
  const graphTool = page.locator('#drawingToolList [data-tool-id="math-plot"]').first();

  if ((await graphTool.count()) === 0) {
    return { error: "no Graph tool in MATH / ANALYSIS", log };
  }

  await graphTool.click();
  await page.waitForTimeout(400);

  /*
   * THE MODE MENU IS AN INLINE LIST under the tool, not a dialog - and an
   * inline list has TEXT rather than accessible names, so it is read and
   * clicked by its own `data-submenu-id`.
   */
  const submenu = await page.evaluate(() =>
    document.querySelector(".drawing-coordinate-submenu")?.innerText || null,
  );

  log.push("SUBMENU: " + JSON.stringify(submenu));

  await page
    .locator('.drawing-coordinate-submenu [data-submenu-id="sketch"]')
    .first()
    .click();

  await page.waitForSelector(".drawing-graph-sketch [data-sketch-svg]", {
    timeout: 30000,
  });

  await page.waitForTimeout(400);

  const open = await page.evaluate(() => {
    const dialog = document.querySelector(".drawing-graph-sketch");

    if (!dialog) {
      return { open: false };
    }

    const rect = (selector) => {
      const node = dialog.querySelector(selector);
      const box = node?.getBoundingClientRect();

      return box
        ? {
            w: Math.round(box.width),
            h: Math.round(box.height),
            x: Math.round(box.x),
            y: Math.round(box.y),
          }
        : null;
    };

    const svg = dialog.querySelector("[data-sketch-svg]");

    return {
      open: true,
      dialog: rect(".sketch-app"),
      stage: rect(".sketch-stage"),
      canvas: rect(".sketch-canvas"),
      inspector: rect(".sketch-inspector"),
      toolbar: rect(".sketch-app-toolbar"),
      svgBox: svg?.getAttribute("viewBox"),
      tickLabels: dialog.querySelectorAll('[data-label="tick"]').length,
      axisNames: dialog.querySelectorAll('[data-label="axis-name"]').length,
      gridLines: svg?.querySelectorAll("line").length,
      inspectorVisible:
        getComputedStyle(dialog.querySelector(".sketch-inspector")).display !==
        "none",
      title: dialog.querySelector(".sketch-app-title")?.textContent.trim(),
    };
  });

  log.push("OPEN: " + JSON.stringify(open));

  /* Draw two wobbly strokes with the mouse. */
  const canvasBox = await page
    .locator(".drawing-graph-sketch [data-sketch-svg]")
    .boundingBox();

  const draw = async (from, to, wobble) => {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();

    const steps = 40;

    for (let index = 1; index <= steps; index += 1) {
      const t = index / steps;

      await page.mouse.move(
        from.x + (to.x - from.x) * t,
        from.y + (to.y - from.y) * t + Math.sin(t * Math.PI * 6) * wobble,
      );
    }

    await page.mouse.up();
    await page.waitForTimeout(200);
  };

  await draw(
    {
      x: canvasBox.x + canvasBox.width * 0.2,
      y: canvasBox.y + canvasBox.height * 0.5,
    },
    {
      x: canvasBox.x + canvasBox.width * 0.8,
      y: canvasBox.y + canvasBox.height * 0.52,
    },
    4,
  );

  await draw(
    {
      x: canvasBox.x + canvasBox.width * 0.25,
      y: canvasBox.y + canvasBox.height * 0.75,
    },
    {
      x: canvasBox.x + canvasBox.width * 0.75,
      y: canvasBox.y + canvasBox.height * 0.75,
    },
    3,
  );

  const drawn = await page.evaluate(() => {
    const dialog = document.querySelector(".drawing-graph-sketch");
    const stats = dialog.__datumSketch.stats();

    return {
      strokes: stats.strokes,
      corrected: stats.corrected.map((entry) => entry.kind),
      correctedPoints: stats.corrected.map((entry) => entry.points.length),
      paths: dialog.querySelectorAll(".sketch-corrected-stroke").length,
      rawPaths: dialog.querySelectorAll(".sketch-raw-stroke").length,
      status: dialog.querySelector("[data-sketch-status]")?.textContent,
      hook: typeof dialog.__datumSketch,
    };
  });

  log.push("DRAWN: " + JSON.stringify(drawn));

  /* The three views. */
  const viewCounts = {};

  for (const view of ["original", "corrected", "overlay"]) {
    await page.click(`.drawing-graph-sketch [data-sketch-view="${view}"]`);
    await page.waitForTimeout(150);

    viewCounts[view] = await page.evaluate((name) => {
      const dialog = document.querySelector(".drawing-graph-sketch");

      return {
        active: dialog
          .querySelector(`[data-sketch-view="${name}"]`)
          .classList.contains("active"),
        corrected: dialog.querySelectorAll(".sketch-corrected-stroke").length,
        raw: dialog.querySelectorAll(".sketch-raw-stroke").length,
      };
    }, view);
  }

  log.push("VIEWS: " + JSON.stringify(viewCounts));

  /* A point, then the table. */
  await page.click(".drawing-graph-sketch [data-sketch-tool-point]");
  await page.mouse.click(
    canvasBox.x + canvasBox.width * 0.5,
    canvasBox.y + canvasBox.height * 0.4,
  );
  await page.waitForTimeout(200);

  const points = await page.evaluate(() => {
    const dialog = document.querySelector(".drawing-graph-sketch");

    return {
      points: dialog.__datumSketch.stats().points,
      rows: dialog.querySelectorAll("[data-sketch-point-row]").length,
      handles: dialog.querySelectorAll("[data-sketch-handle]").length,
      ticks: dialog.querySelectorAll('[data-label="tick"]').length,
    };
  });

  log.push("POINTS: " + JSON.stringify(points));

  const narrow = await page.evaluate(() => {
    window.dispatchEvent(new Event("resize"));
    return null;
  });

  void narrow;

  await page.screenshot({ path: "qa/graph-sketch-wide.png" });

  /* Now a narrow window: the inspector must fold, not the graph. */
  await page.setViewportSize({ width: 820, height: 620 });
  await page.waitForTimeout(500);

  const small = await page.evaluate(() => {
    const dialog = document.querySelector(".drawing-graph-sketch");
    const app = dialog.querySelector("[data-sketch-app]");
    const svg = dialog.querySelector("[data-sketch-svg]");
    const stage = dialog.querySelector(".sketch-stage").getBoundingClientRect();
    const canvas = dialog
      .querySelector(".sketch-canvas")
      .getBoundingClientRect();

    return {
      narrow: app.classList.contains("is-narrow"),
      collapsed: app.classList.contains("inspector-collapsed"),
      svgBox: svg.getAttribute("viewBox"),
      stage: { w: Math.round(stage.width), h: Math.round(stage.height) },
      canvas: { w: Math.round(canvas.width), h: Math.round(canvas.height) },
      strokes: dialog.__datumSketch.stats().strokes,
    };
  });

  log.push("NARROW: " + JSON.stringify(small));

  await page.screenshot({ path: "qa/graph-sketch-narrow.png" });

  return { log };
}

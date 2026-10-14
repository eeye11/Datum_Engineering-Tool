/*
 * Pipe / Duct acceptance verification.
 *
 * Drives the REAL workspace: arm the tool from the Fluids menu, click points
 * on the actual canvas, and read the SVG the renderer produced. Every check
 * asks the DOM, never the model.
 */
export default async function run(page, ui) {
  const out = { tests: {} };

  const log = [];
  page.on("console", (m) => {
    if (m.type() === "error") log.push(m.text());
  });

  await page.waitForTimeout(1200);
  await page.getByRole("button", { name: "Engineering Drawing" }).click();
  await page.waitForTimeout(700);

  const svgBox = await page.evaluate(() => {
    const svg = document.querySelector(".drawing-canvas svg");
    const b = svg.getBoundingClientRect();
    return { x: b.x, y: b.y, w: b.width, h: b.height };
  });
  out.svgBox = svgBox;
  const cx = svgBox.x + svgBox.w / 2;
  const cy = svgBox.y + svgBox.h / 2;

  /* Every route-like polyline currently drawn, as screen points. */
  const routeLines = () =>
    page.evaluate(() => {
      const svg = document.querySelector(".drawing-canvas svg");
      return [...svg.querySelectorAll("polyline")]
        .map((p) => p.getAttribute("points") || "")
        .filter((pts) => pts.trim().length > 0);
    });

  const message = () =>
    page.evaluate(
      () =>
        document.getElementById("drawingToolMessage")?.textContent?.trim() ||
        "",
    );

  const arm = async () => {
    const s = await ui.snapshot();
    const f = s.match(/@(e\d+) button "FLUIDS"/)?.[1];
    if (f) await ui.click(f);
    await page.waitForTimeout(300);
    const s2 = await ui.snapshot();
    const p = s2.match(/@(e\d+) button "Pipe \/ Duct/)?.[1];
    await ui.click(p);
    await page.waitForTimeout(300);
  };

  /* Click a list of screen points, sampling the canvas after each. */
  const draw = async (points) => {
    const samples = [];
    for (const [x, y] of points) {
      await page.mouse.move(x, y, { steps: 4 });
      await page.waitForTimeout(120);
      await page.mouse.down();
      await page.mouse.up();
      await page.waitForTimeout(180);
      samples.push(await routeLines());
    }
    return samples;
  };

  const finish = async () => {
    await page.keyboard.press("Enter");
    await page.waitForTimeout(400);
    return routeLines();
  };

  /* ---------------------------------------------------------------
   * 1. Straight horizontal route.
   * --------------------------------------------------------------- */
  await arm();
  out.tests.horizontal_armedMessage = await message();
  const hSamples = await draw([
    [cx - 250, cy - 160],
    [cx + 60, cy - 160],
  ]);
  out.tests.horizontal_previewAfterFirstClick = hSamples[0];
  out.tests.horizontal_committedDuringCreation = hSamples[1];
  out.tests.horizontal_afterFinish = await finish();
  out.tests.horizontal_message = await message();

  /* ---------------------------------------------------------------
   * 2. Straight vertical route.
   * --------------------------------------------------------------- */
  await arm();
  await draw([
    [cx + 230, cy - 160],
    [cx + 230, cy + 90],
  ]);
  out.tests.vertical_afterFinish = await finish();

  /* ---------------------------------------------------------------
   * 3. Multiple connected segments + 90 deg corner.
   * --------------------------------------------------------------- */
  await arm();
  await draw([
    [cx - 250, cy + 90],
    [cx - 110, cy + 90],
    [cx - 110, cy - 40],
  ]);
  out.tests.multi90_afterFinish = await finish();
  out.tests.multi90_message = await message();

  /* ---------------------------------------------------------------
   * 4. 45 degree corner (100,100 then 100,0).
   * --------------------------------------------------------------- */
  await arm();
  await draw([
    [cx - 250, cy + 170],
    [cx - 150, cy + 250],
    [cx - 50, cy + 250],
  ]);
  out.tests.corner45_afterFinish = await finish();

  /* ---------------------------------------------------------------
   * 5. Snap onto an existing route endpoint (route 1's end).
   * --------------------------------------------------------------- */
  await arm();
  await draw([
    [cx - 320, cy - 250],
    [cx + 60, cy - 160],
    [cx + 60, cy - 250],
  ]);
  out.tests.snap_afterFinish = await finish();
  out.tests.snap_message = await message();

  /* ---------------------------------------------------------------
   * 6. Cancellation leaves no orphaned geometry.
   * --------------------------------------------------------------- */
  await arm();
  await draw([
    [cx, cy],
    [cx + 70, cy],
  ]);
  const beforeEscape = (await routeLines()).length;
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  const afterEscape = (await routeLines()).length;
  out.tests.cancel = {
    beforeEscape,
    afterEscape,
    message: await message(),
  };

  /* ---------------------------------------------------------------
   * Selection + edit: click the first route, then drag its endpoint.
   * --------------------------------------------------------------- */
  const treeBefore = await page.evaluate(() => {
    const t = document.querySelector(".drawing-feature-tree, #featureTree");
    return t ? t.innerText.replace(/\s+/g, " ").slice(0, 500) : null;
  });
  out.featureTree = treeBefore;

  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  await page.mouse.click(cx - 250, cy - 160);
  await page.waitForTimeout(400);
  out.tests.selection = {
    message: await message(),
    selectionStroke: await page.evaluate(() => {
      const svg = document.querySelector(".drawing-canvas svg");
      const polys = [...svg.querySelectorAll("polyline")];
      return polys
        .map((p) => p.getAttribute("stroke"))
        .filter((s, i, a) => a.indexOf(s) === i)
        .slice(0, 8);
    }),
  };

  out.totalPolylines = (await routeLines()).length;
  out.consoleErrors = log;

  return out;
}

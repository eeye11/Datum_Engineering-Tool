/*
 * Fluids Pipe / Duct route QA: draw routes in the real application and read
 * back what the document, the Features panel and the Feature Tree actually
 * contain.
 *
 * Everything here is observed through the running app - the model is read via
 * the modules the app itself loaded (window.__daetumQA is NOT used; instead we
 * read the DOM, the panel and the tree), so the result describes the student's
 * experience rather than the source's intent.
 */
export default async function run(page, ui) {
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: "Engineering Drawing" }).click();
  await page.waitForTimeout(600);

  const out = {};

  const switchFluids = async () => {
    await page.evaluate(() => {
      const b = [...document.querySelectorAll(".drawing-category")].find(
        (el) => el.dataset.category === "FLUIDS",
      );
      if (b) b.click();
    });
    await page.waitForTimeout(250);
  };

  const armPipe = async (routeType) => {
    await switchFluids();
    const ok = await page.evaluate((type) => {
      const b = document.querySelector(
        '.drawing-tool[data-tool-id="pipe-duct"]',
      );
      if (!b) return false;
      b.click();
      // The route type is decided when the tool is armed; if the tool exposes
      // a type toggle we honour it, otherwise the default (pipe) is used.
      const toggle = document.querySelector(`[data-route-type="${type}"]`);
      if (toggle) toggle.click();
      return true;
    }, routeType || "pipe");
    await page.waitForTimeout(250);
    return ok;
  };

  const svgBox = await page.evaluate(() => {
    const svg = document.querySelector(".drawing-canvas svg");
    const b = svg.getBoundingClientRect();
    return { x: b.x, y: b.y, width: b.width, height: b.height };
  });
  out.svg = svgBox;
  const cx = svgBox.x + svgBox.width / 2;
  const cy = svgBox.y + svgBox.height / 2;

  /* Read the feature tree rows, so hierarchy is observed, not inferred. */
  const treeRows = () =>
    page.evaluate(() => {
      const tree = document.querySelector(
        "#drawingFeatureTree, #featureTree, .drawing-feature-tree",
      );
      if (!tree) return null;
      return [...tree.querySelectorAll("[data-object-id]")].map((el) => ({
        id: el.dataset.objectId,
        text: el.textContent.trim().slice(0, 60),
        depth: (el.getAttribute("aria-level") || "").trim(),
      }));
    });

  /* Read the Features panel rows: label -> value, observed from the DOM. */
  const panelRows = () =>
    page.evaluate(() => {
      const grid = document.querySelector(
        "#drawingPropertyPanel, .drawing-property-panel, .drawing-property-grid",
      );
      if (!grid) return null;
      return [...grid.querySelectorAll(".drawing-property-row")].map((row) => ({
        label:
          row.querySelector(".drawing-property-label")?.textContent?.trim() ||
          "",
        value:
          row.querySelector("input, select")?.value ??
          row.querySelector(".drawing-property-value")?.textContent?.trim() ??
          "",
        property:
          row.querySelector("[data-property]")?.dataset.property || null,
        readOnly: !row.querySelector("input, select"),
      }));
    });

  /* Count what the SVG actually draws for routes/segments/elbows. */
  const drawnPolylines = () =>
    page.evaluate(() =>
      [...document.querySelectorAll(".drawing-canvas svg polyline")]
        .map((p) => p.getAttribute("points"))
        .filter(Boolean),
    );

  /* All objects, via the app's own serialized drawing (the save path). */
  const objects = () =>
    page.evaluate(() => {
      const api = window.__daetumQA || null;
      if (api && api.objects) return api.objects();
      return null;
    });

  const drawRoute = async (points, finish = "Enter") => {
    for (const [x, y] of points) {
      await page.mouse.click(x, y);
      await page.waitForTimeout(180);
    }
    const during = (await drawnPolylines()).length;
    await page.keyboard.press(finish);
    await page.waitForTimeout(400);
    return {
      during,
      status: await page.evaluate(
        () =>
          document.getElementById("drawingToolMessage")?.textContent?.trim() ||
          "",
      ),
    };
  };

  // ---- T1: straight route (2 points) ----
  await armPipe("pipe");
  out.t1_straight = await drawRoute([
    [cx - 260, cy - 180],
    [cx + 40, cy - 180],
  ]);

  // ---- T2: 90-degree corner route ----
  await armPipe("pipe");
  out.t2_corner90 = await drawRoute([
    [cx - 260, cy - 60],
    [cx - 120, cy - 60],
    [cx - 120, cy + 60],
  ]);

  // ---- T3: multi-bend route (two 90s) ----
  await armPipe("pipe");
  out.t3_multi = await drawRoute([
    [cx + 60, cy - 180],
    [cx + 180, cy - 180],
    [cx + 180, cy - 60],
    [cx + 300, cy - 60],
  ]);

  // ---- T4: Escape cancellation leaves nothing ----
  await armPipe("pipe");
  await page.mouse.click(cx + 400, cy + 200);
  await page.waitForTimeout(150);
  await page.mouse.click(cx + 460, cy + 200);
  await page.waitForTimeout(150);
  const beforeEscape = (await drawnPolylines()).length;
  await page.keyboard.press("Escape");
  await page.waitForTimeout(350);
  out.t4_cancel = {
    beforeEscape,
    afterEscape: (await drawnPolylines()).length,
    status: await page.evaluate(
      () =>
        document.getElementById("drawingToolMessage")?.textContent?.trim() ||
        "",
    ),
  };

  // ---- T5: read the tree and panel after selecting the route ----
  out.tree = await treeRows();
  out.panel = await panelRows();
  out.polylines = (await drawnPolylines()).length;

  return out;
}

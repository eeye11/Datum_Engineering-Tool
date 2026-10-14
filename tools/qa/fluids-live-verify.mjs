/*
 * Fluids Pipe / Duct LIVE canvas verification.
 *
 * The question this answers is the acceptance criterion itself: does a visible,
 * connected, editable schematic appear ON THE CANVAS while the student draws,
 * and stay after completion? Everything is read back from the real SVG the
 * renderer produced, not from the model.
 */
export default async function run(page, ui) {
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: "Engineering Drawing" }).click();
  await page.waitForTimeout(600);

  const out = { steps: [] };

  const switchFluids = async () => {
    await page.evaluate(() => {
      [...document.querySelectorAll(".drawing-category")]
        .find((el) => el.dataset.category === "FLUIDS")
        ?.click();
    });
    await page.waitForTimeout(200);
  };

  const armPipe = async () => {
    await switchFluids();
    await page.evaluate(() => {
      document
        .querySelector('.drawing-tool[data-tool-id="pipe-duct"]')
        ?.click();
    });
    await page.waitForTimeout(250);
  };

  /* Read every drawn polyline/circle/line in the canvas. */
  const canvasShapes = () =>
    page.evaluate(() => {
      const svg = document.querySelector(".drawing-canvas svg");
      if (!svg) return { error: "no svg" };
      const polys = [...svg.querySelectorAll("polyline")].map((p) => ({
        tag: "polyline",
        points: p.getAttribute("points"),
        cls: p.getAttribute("class") || "",
        parent: p.parentElement?.getAttribute("class") || "",
      }));
      const circles = [...svg.querySelectorAll("circle")].map((c) => ({
        tag: "circle",
        cx: c.getAttribute("cx"),
        cy: c.getAttribute("cy"),
        r: c.getAttribute("r"),
        parent: c.parentElement?.getAttribute("class") || "",
      }));
      return { polys, circles };
    });

  const status = () =>
    page.evaluate(
      () =>
        document.getElementById("drawingToolMessage")?.textContent?.trim() ||
        "",
    );

  const svgBox = await page.evaluate(() => {
    const svg = document.querySelector(".drawing-canvas svg");
    const b = svg.getBoundingClientRect();
    return { x: b.x, y: b.y, width: b.width, height: b.height };
  });
  const cx = svgBox.x + svgBox.width / 2;
  const cy = svgBox.y + svgBox.height / 2;
  out.svg = svgBox;

  /* ---------- LIVE PREVIEW: click 1, move, look ---------- */
  await armPipe();
  out.armedStatus = await status();

  await page.mouse.move(cx - 200, cy);
  await page.mouse.click(cx - 200, cy);
  await page.waitForTimeout(200);
  out.afterFirstClick = {
    shapes: await canvasShapes(),
    status: await status(),
  };

  /* Move the pointer - a live preview segment must appear. */
  await page.mouse.move(cx - 40, cy, { steps: 8 });
  await page.waitForTimeout(350);
  out.afterMovePreview = {
    shapes: await canvasShapes(),
    status: await status(),
  };

  /* Second click commits the first segment; move again for the next. */
  await page.mouse.click(cx - 40, cy);
  await page.waitForTimeout(200);
  await page.mouse.move(cx - 40, cy - 120, { steps: 8 });
  await page.waitForTimeout(350);
  out.afterSecondMove = {
    shapes: await canvasShapes(),
    status: await status(),
  };

  /* Finish with Enter. */
  await page.keyboard.press("Enter");
  await page.waitForTimeout(400);
  out.afterFinish = { shapes: await canvasShapes(), status: await status() };

  /* ---------- Selection + editability ---------- */
  out.selectedAfterFinish = await page.evaluate(() => {
    const sel = document.querySelectorAll(".drawing-canvas .drawing-selected");
    return sel.length;
  });

  /* Read the Features panel rows for the selected route. */
  out.panel = await page.evaluate(() => {
    const grid = document.querySelector("#drawingProperties");
    if (!grid) return null;
    return [...grid.querySelectorAll(".drawing-property-row")].map((row) => ({
      label:
        row.querySelector(".drawing-property-label")?.textContent?.trim() || "",
      property: row.querySelector("[data-property]")?.dataset.property || null,
    }));
  });

  /* ---------- Feature tree ---------- */
  out.tree = await page.evaluate(() => {
    const rows = [...document.querySelectorAll(".drawing-component-row")];
    return rows.map((r) => r.textContent.trim().slice(0, 70));
  });

  return out;
}

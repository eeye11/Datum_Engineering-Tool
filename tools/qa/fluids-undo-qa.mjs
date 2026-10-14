export default async function run(page, ui) {
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: "Engineering Drawing" }).click();
  await page.waitForTimeout(600);

  const out = {};

  const switchFluids = async () => {
    await page.evaluate(() => {
      [...document.querySelectorAll(".drawing-category")]
        .find((el) => el.dataset.category === "FLUIDS")
        ?.click();
    });
    await page.waitForTimeout(200);
  };

  const svgBox = await page.evaluate(() => {
    const svg = document.querySelector(".drawing-canvas svg");
    const b = svg.getBoundingClientRect();
    return { x: b.x, y: b.y, width: b.width, height: b.height };
  });
  const cx = svgBox.x + svgBox.width / 2;
  const cy = svgBox.y + svgBox.height / 2;

  /* All polylines drawn, which is how a route appears on the canvas. */
  const polylines = () =>
    page.evaluate(
      () =>
        [...document.querySelectorAll(".drawing-canvas svg polyline")].filter(
          (p) => p.getAttribute("points"),
        ).length,
    );

  const treeRows = () =>
    page.evaluate(() =>
      [...document.querySelectorAll(".drawing-component-row")].map((r) =>
        r.textContent.trim().slice(0, 40),
      ),
    );

  const findToolbarButton = () =>
    page.evaluate(() => {
      const ids = [...document.querySelectorAll("button")].map((b) => ({
        text: b.textContent.trim(),
        id: b.id,
        title: b.title,
        aria: b.getAttribute("aria-label"),
      }));
      return ids.filter(
        (b) =>
          /undo|redo/i.test(b.text) ||
          /undo|redo/i.test(b.id) ||
          /undo|redo/i.test(b.title) ||
          /undo|redo/i.test(b.aria),
      );
    });

  out.undoButtons = await findToolbarButton();

  // Draw a route.
  await switchFluids();
  await page.evaluate(() => {
    document.querySelector('.drawing-tool[data-tool-id="pipe-duct"]')?.click();
  });
  await page.waitForTimeout(200);

  for (const [x, y] of [
    [cx - 200, cy - 100],
    [cx - 40, cy - 100],
    [cx - 40, cy + 100],
  ]) {
    await page.mouse.click(x, y);
    await page.waitForTimeout(180);
  }
  await page.keyboard.press("Enter");
  await page.waitForTimeout(500);

  out.afterCreate = { polylines: await polylines(), rows: await treeRows() };

  // Press Undo via the real button (by id if known).
  const pressUndo = async () => {
    return page.evaluate(() => {
      const byId = document.getElementById("drawingUndo");
      if (byId) {
        byId.click();
        return "by-id";
      }
      const b = [...document.querySelectorAll("button")].find((x) =>
        /undo/i.test(x.title || x.getAttribute("aria-label") || x.textContent),
      );
      if (b) {
        b.click();
        return "by-match";
      }
      return "not-found";
    });
  };

  out.undoHow = await pressUndo();
  await page.waitForTimeout(500);
  out.afterUndo = { polylines: await polylines(), rows: await treeRows() };

  const pressRedo = async () =>
    page.evaluate(() => {
      const byId = document.getElementById("drawingRedo");
      if (byId) {
        byId.click();
        return "by-id";
      }
      return "not-found";
    });

  out.redoHow = await pressRedo();
  await page.waitForTimeout(500);
  out.afterRedo = { polylines: await polylines(), rows: await treeRows() };

  return out;
}

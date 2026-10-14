/*
 * Drives the Distributed Load creation and reports WHEN the magnitude popup
 * appears: after the span is defined, or only after the load click.
 */
export default async function run(page, ui) {
  const results = {};

  const popupCount = () =>
    page.evaluate(
      () => document.querySelectorAll(".drawing-creation-dimension").length,
    );

  // Find the Distributed Load tool button.
  const snap = await ui.snapshot();
  results.snapshotSample = snap.split("\n").slice(0, 40).join("\n");

  const loadButton = snap.match(
    /@(e\d+) button "[^"]*Distributed Load[^"]*"/,
  )?.[1];
  results.foundLoadButton = Boolean(loadButton);

  if (!loadButton) {
    results.allButtons = snap
      .split("\n")
      .filter((l) => /button/.test(l))
      .slice(0, 60)
      .join("\n");
    return results;
  }

  await ui.click(loadButton);
  await page.waitForTimeout(300);

  // Read the canvas bounds so we can drive pointer events on it.
  const canvasBox = await page.evaluate(() => {
    const c = document.querySelector("canvas");
    if (!c) return null;
    const r = c.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });

  results.canvasBox = canvasBox;

  if (!canvasBox) return results;

  const at = (fx, fy) => ({
    x: canvasBox.x + canvasBox.width * fx,
    y: canvasBox.y + canvasBox.height * fy,
  });

  // Interaction 1: the span, by drag.
  const start = at(0.3, 0.5);
  const end = at(0.6, 0.5);

  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 10 });
  await page.mouse.up();

  await page.waitForTimeout(300);

  results.popupAfterSpanDrag = await popupCount();
  results.popupAfterSpanDragText = await page.evaluate(
    () =>
      document.querySelector(".drawing-creation-dimension")?.innerText || null,
  );

  // Interaction 2: move the cursor, then click to define the load.
  const loadPoint = at(0.6, 0.3);
  await page.mouse.move(loadPoint.x, loadPoint.y);
  await page.waitForTimeout(100);

  results.popupAfterMove = await popupCount();

  await page.mouse.click(loadPoint.x, loadPoint.y);
  await page.waitForTimeout(300);

  results.popupAfterLoadClick = await popupCount();
  results.popupAfterLoadClickText = await page.evaluate(
    () =>
      document.querySelector(".drawing-creation-dimension")?.innerText || null,
  );

  return results;
}

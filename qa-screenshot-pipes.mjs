export default async function run(page, ui) {
  await page.evaluate(async () => {
    if (!window.enggDrawing) await import("/src/main.js");
  });
  await page.waitForFunction(() => !!window.enggDrawing);
  await page.waitForTimeout(400);

  // Switch to Engineering Drawing
  await page.getByRole("button", { name: "Engineering Drawing" }).click();
  await page.waitForTimeout(400);

  // Switch to FLUIDS
  await page.evaluate(() => {
    [...document.querySelectorAll("button")]
      .find((b) => b.textContent.trim() === "FLUIDS")
      ?.click();
  });
  await page.waitForTimeout(300);

  const snap = await ui.snapshot();
  const pipeBtn = snap.match(/@(e\d+) button "Pipe \/ Duct/)?.[1];
  if (pipeBtn) await ui.click(pipeBtn);
  await page.waitForTimeout(300);

  const box = await page.evaluate(() => {
    const b = document
      .querySelector(".drawing-canvas svg")
      .getBoundingClientRect();
    return { x: b.x, y: b.y, w: b.width, h: b.height };
  });
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;

  // Draw horizontal run
  await page.mouse.move(cx - 150, cy);
  await page.mouse.down();
  await page.mouse.move(cx, cy, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(200);

  // Draw 90 deg corner downward
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx, cy + 120, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(200);

  // Take screenshot of canvas
  const canvasEl = await page.locator(".drawing-canvas");
  await canvasEl.screenshot({ path: "qa-pipe-narrow.png" });

  const lines = await page.evaluate(() => {
    return [...document.querySelectorAll(".drawing-canvas svg line")].map(
      (l) => ({
        x1: l.getAttribute("x1"),
        y1: l.getAttribute("y1"),
        x2: l.getAttribute("x2"),
        y2: l.getAttribute("y2"),
        stroke: l.getAttribute("stroke"),
      }),
    );
  });

  return { ok: true, lines };
}

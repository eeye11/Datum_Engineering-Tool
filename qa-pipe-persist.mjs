export default async function run(page, ui) {
  await page.waitForTimeout(1000);
  await page.evaluate(() => {
    [...document.querySelectorAll("button")]
      .find((b) => /engineering drawing/i.test(b.textContent))
      ?.click();
  });
  await page.waitForTimeout(700);

  const out = {};

  // Arm Pipe/Duct via UI clicks.
  await page.evaluate(() => {
    [...document.querySelectorAll("button")]
      .find((b) => b.textContent.trim() === "FLUIDS")
      ?.click();
  });
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    [...document.querySelectorAll("button")]
      .find((b) => b.textContent.trim() === "Pipe / Duct")
      ?.click();
  });
  await page.waitForTimeout(400);

  const svgBox = await page.evaluate(() => {
    const b = document
      .querySelector(".drawing-canvas svg")
      .getBoundingClientRect();
    return { x: b.x, y: b.y, width: b.width, height: b.height };
  });
  const cx = svgBox.x + svgBox.width / 2;
  const cy = svgBox.y + svgBox.height / 2;

  // First click: start point.
  await page.mouse.click(cx - 100, cy + 50);
  await page.waitForTimeout(200);
  // Move the pointer without clicking: is there a live preview?
  await page.mouse.move(cx + 100, cy + 50, { steps: 8 });
  await page.waitForTimeout(300);
  out.previewShapes = await page.evaluate(() => {
    const svg = document.querySelector(".drawing-canvas svg");
    return [...svg.querySelectorAll("path,line,polyline,circle")]
      .filter((el) => el.getAttribute("class") !== "drawing-engineering-grid")
      .map(
        (el) =>
          el.tagName +
          ":" +
          (
            el.getAttribute("points") ||
            el.getAttribute("d") ||
            el.getAttribute("x1") ||
            ""
          ).slice(0, 80),
      );
  });

  // Second click commits; check committed geometry remains while moving.
  await page.mouse.click(cx + 100, cy + 50);
  await page.waitForTimeout(200);
  await page.mouse.move(cx + 100, cy - 60, { steps: 8 });
  await page.waitForTimeout(300);
  out.afterSecondClickShapes = await page.evaluate(() => {
    const svg = document.querySelector(".drawing-canvas svg");
    return [...svg.querySelectorAll("polyline")].map((el) =>
      el.getAttribute("points"),
    );
  });

  // Finish, then SAVE through the File menu (or Ctrl+S), then reload.
  await page.keyboard.press("Enter");
  await page.waitForTimeout(400);

  out.documentKeys = await page.evaluate(() =>
    Object.keys(localStorage).map((k) => k.slice(0, 60)),
  );

  // Try Ctrl+S.
  await page.keyboard.press("Control+s");
  await page.waitForTimeout(500);
  out.afterCtrlS = await page.evaluate(() => {
    const msg = document.getElementById("drawingToolMessage");
    return msg?.textContent?.trim();
  });
  out.documentKeys2 = await page.evaluate(() =>
    Object.keys(localStorage).map((k) => k.slice(0, 60)),
  );

  await page.reload();
  await page.waitForTimeout(2000);
  await page.evaluate(() => {
    [...document.querySelectorAll("button")]
      .find((b) => /engineering drawing/i.test(b.textContent))
      ?.click();
  });
  await page.waitForTimeout(800);
  out.afterReloadPolylines = await page.evaluate(() => {
    const svg = document.querySelector(".drawing-canvas svg");
    return svg
      ? [...svg.querySelectorAll("polyline")].map((el) =>
          el.getAttribute("points"),
        )
      : "no svg";
  });

  return out;
}

export default async function run(page) {
  const wait = (ms) => page.waitForTimeout(ms);
  const out = {};

  await page.locator('.tab[data-tab="drawing"]').click({ force: true });
  await wait(2000);

  await page.evaluate(() => {
    document
      .querySelectorAll("[data-recovery-prompt], .drawing-recovery-prompt")
      .forEach((n) => n.remove());
  });

  /* Draw a polar vector, then inspect its SVG group. */
  await page.evaluate(() => {
    document
      .querySelector('.drawing-category[data-category="DYNAMICS"]')
      ?.click();
  });
  await wait(500);
  await page.evaluate(() => {
    const category = document.querySelector(
      '[data-tool-id="dynamics-kinematics"]',
    );
    if (category?.getAttribute("aria-expanded") === "false") category.click();
  });
  await wait(300);
  await page.evaluate(() => {
    document.querySelector('[data-tool-id="dynamics-polar-vector"]')?.click();
  });
  await wait(300);

  const canvas = await page.locator(".drawing-canvas").first().boundingBox();

  await page.mouse.move(canvas.x + 250, canvas.y + 220);
  await page.mouse.down();
  await page.mouse.move(canvas.x + 400, canvas.y + 300, { steps: 8 });
  await page.mouse.up();
  await wait(800);
  await page.keyboard.press("Escape");
  await wait(500);

  out.svg = await page.evaluate(() => {
    const groups = [...document.querySelectorAll("[data-feature-id]")];

    return groups.map((group) => ({
      id: group.getAttribute("data-feature-id")?.slice(0, 8),
      lines: group.querySelectorAll("line").length,
      paths: group.querySelectorAll("path").length,
      circles: group.querySelectorAll("circle").length,
      pathFill: [...group.querySelectorAll("path")].map((p) =>
        p.getAttribute("fill"),
      ),
      markerEnd: [...group.querySelectorAll("path,line")].map((n) =>
        n.getAttribute("marker-end"),
      ),
    }));
  });

  await page.screenshot({ path: "qa-arrow.png" });

  return out;
}

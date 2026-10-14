export default async function run(page) {
  const tab = page.getByRole("button", { name: "Engineering Drawing" });
  if (await tab.count()) {
    await tab.first().click();
    await page.waitForTimeout(400);
  }
  const box = await page.locator(".drawing-canvas").first().boundingBox();
  const at = (fx, fy) => ({
    x: box.x + box.width * fx,
    y: box.y + box.height * fy,
  });
  const click = async (fx, fy) => {
    const p = at(fx, fy);
    await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(280);
  };
  const tool = async (id) => {
    await page.locator(`.drawing-tool[data-tool-id="${id}"]`).click();
    await page.waitForTimeout(280);
  };
  const sub = async (id) => {
    await page
      .locator(`.drawing-coordinate-submenu-item[data-submenu-id="${id}"]`)
      .click({ timeout: 4000 });
    await page.waitForTimeout(300);
  };

  await page.locator('.drawing-category[data-category="STATICS"]').click();
  await page.waitForTimeout(250);

  // One rigid body, one of each shape, side by side.
  const shapes = ["rectangle", "circle", "triangle", "polygon"];
  for (let i = 0; i < shapes.length; i++) {
    await tool("body");
    await sub("rigid-body");
    await click(0.15 + i * 0.2, 0.35);
    await page
      .locator("#drawingProperties select[data-rigid-shape]")
      .selectOption(shapes[i]);
    await page.waitForTimeout(350);
  }

  // A cable and a shaft for comparison.
  await tool("body");
  await sub("cable");
  await click(0.2, 0.7);
  await click(0.45, 0.7);
  await tool("body");
  await sub("shaft");
  await click(0.55, 0.7);
  await click(0.85, 0.7);
  await page
    .locator("#drawingFeaturesBack")
    .click({ timeout: 4000 })
    .catch(() => {});
  await page.waitForTimeout(400);
  return { done: true };
}

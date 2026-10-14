export default async function run(page) {
  const out = { steps: [] };
  const log = (s, v) => out.steps.push({ step: s, value: v });
  const safe = async (n, f) => {
    try {
      log(n, await f());
    } catch (e) {
      log(n, { error: String(e).slice(0, 200) });
    }
  };
  const tab = page.getByRole("button", { name: "Engineering Drawing" });
  if (await tab.count()) {
    await tab.first().click();
    await page.waitForTimeout(400);
  }
  const box = await page.locator(".drawing-canvas").first().boundingBox();
  if (!box) return { error: "no canvas", ...out };
  const at = (fx, fy) => ({
    x: box.x + box.width * fx,
    y: box.y + box.height * fy,
  });
  const click = async (fx, fy) => {
    const p = at(fx, fy);
    await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(280);
  };
  const category = async (c) => {
    await page.locator(`.drawing-category[data-category="${c}"]`).click();
    await page.waitForTimeout(250);
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
  const panel = () =>
    page.evaluate(() =>
      document
        .querySelector("#drawingProperties")
        .innerText.replace(/\n+/g, " | "),
    );
  const back = async () => {
    await page
      .locator("#drawingFeaturesBack")
      .click({ timeout: 4000 })
      .catch(() => {});
    await page.waitForTimeout(250);
  };

  await category("STATICS");

  // Particle: must have no line-style properties.
  await tool("body");
  await sub("particle");
  await click(0.3, 0.5);
  await safe("particle panel", panel);

  // Rigid Body: shape dropdown and per-shape properties.
  await tool("body");
  await sub("rigid-body");
  await click(0.5, 0.5);
  await safe("rigid rect panel", panel);
  for (const shape of ["circle", "triangle", "polygon", "rectangle"]) {
    await safe("switch to " + shape, async () => {
      await page
        .locator("#drawingProperties select[data-rigid-shape]")
        .selectOption(shape);
      await page.waitForTimeout(350);
      return panel();
    });
  }
  await safe("rigid still one feature", () =>
    page.evaluate(() =>
      [...document.querySelectorAll(".drawing-component-row span")].map((s) =>
        s.textContent.trim(),
      ),
    ),
  );
  return out;
}

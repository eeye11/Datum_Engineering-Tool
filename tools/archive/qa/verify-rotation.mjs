export default async function run(page) {
  const out = { steps: [] };
  const log = (s, v) => out.steps.push({ step: s, value: v });
  const safe = async (n, f) => {
    try {
      log(n, await f());
    } catch (e) {
      log(n, { error: String(e).slice(0, 150) });
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
    await page.waitForTimeout(260);
  };
  const category = async (c) => {
    await page.locator(`.drawing-category[data-category="${c}"]`).click();
    await page.waitForTimeout(250);
  };
  const tool = async (id) => {
    await page.locator(`.drawing-tool[data-tool-id="${id}"]`).click();
    await page.waitForTimeout(260);
  };
  const sub = async (label) => {
    await page
      .locator(".drawing-coordinate-submenu-item", { hasText: label })
      .first()
      .click();
    await page.waitForTimeout(280);
  };

  const panel = () =>
    page.evaluate(() => {
      const rows = [
        ...document.querySelectorAll(
          "#drawingProperties .drawing-property-grid",
        ),
      ].map((r) => [
        r.querySelector(".drawing-property-grid-label")?.textContent.trim(),
        r.querySelector("input,select")?.value,
      ]);
      return rows.filter(([k, v]) => k && v !== undefined);
    });
  const handles = () =>
    page.evaluate(() =>
      [...document.querySelectorAll(".drawing-manipulation-handle")].map(
        (c) => ({
          k: c
            .getAttribute("class")
            .replace("drawing-manipulation-handle", "")
            .trim(),
          x: Math.round(+c.getAttribute("cx")),
          y: Math.round(+c.getAttribute("cy")),
        }),
      ),
    );
  const rotateBy = async (dx, dy) => {
    const h = await page.evaluate(() => {
      const c = document.querySelector(".drawing-manipulation-handle.rotation");
      if (!c) return null;
      const r = document
        .querySelector(".drawing-canvas")
        .getBoundingClientRect();
      return {
        x: r.left + +c.getAttribute("cx"),
        y: r.top + +c.getAttribute("cy"),
      };
    });
    if (!h) return "no rotation handle";
    await page.mouse.move(h.x, h.y);
    await page.waitForTimeout(80);
    await page.mouse.down();
    await page.waitForTimeout(80);
    await page.mouse.move(h.x + dx, h.y + dy, { steps: 14 });
    await page.waitForTimeout(120);
    await page.mouse.up();
    await page.waitForTimeout(380);
    return "ok";
  };
  const snap = async () => ({ panel: await panel(), handles: await handles() });

  await category("GEOMETRY");
  await tool("rectangle");
  await click(0.3, 0.35);
  await click(0.45, 0.5);
  await safe("rect before", snap);
  await safe("rect rotate", () => rotateBy(40, 55));
  await safe("rect after", snap);

  await tool("triangle");
  await click(0.6, 0.3);
  await click(0.68, 0.45);
  await click(0.55, 0.45);
  await safe("tri before", snap);
  await safe("tri rotate", () => rotateBy(0, 70));
  await safe("tri after", snap);

  await category("STATICS");
  await tool("body");
  await sub("Truss");
  await click(0.2, 0.6);
  await click(0.8, 0.6);
  await safe("truss before", snap);
  await safe("truss rotate", () => rotateBy(0, 60));
  await safe("truss after", snap);

  return out;
}

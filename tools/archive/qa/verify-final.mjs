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
  const names = () =>
    page.evaluate(() =>
      [...document.querySelectorAll(".drawing-component-row")].map((r) => ({
        n: r.querySelector("span").textContent.trim(),
        c: r.classList.contains("drawing-component-row-child"),
      })),
    );
  const feats = () =>
    page.evaluate(
      () =>
        document.querySelectorAll("g.drawing-feature[data-feature-id]").length,
    );
  const back = async () => {
    await page
      .locator("#drawingFeaturesBack")
      .click({ timeout: 4000 })
      .catch(() => {});
    await page.waitForTimeout(250);
  };
  // Drag a body (not a handle) to prove children travel with it.
  const dragBody = async (from, to) => {
    const a = at(...from),
      b = at(...to);
    await page.mouse.move(a.x, a.y);
    await page.waitForTimeout(80);
    await page.mouse.down();
    await page.waitForTimeout(80);
    await page.mouse.move(b.x, b.y, { steps: 12 });
    await page.waitForTimeout(120);
    await page.mouse.up();
    await page.waitForTimeout(400);
  };
  const panelXY = () =>
    page.evaluate(() => {
      const o = {};
      document
        .querySelectorAll("#drawingProperties .drawing-property-grid")
        .forEach((g) => {
          const k = g
            .querySelector(".drawing-property-grid-label")
            ?.textContent.trim();
          const v = g.querySelector("input,select")?.value;
          if (k && /^(Start|End|Position) [XY]$/.test(k)) o[k] = v;
        });
      return o;
    });

  await category("STATICS");
  await tool("body");
  await sub("beam");
  await click(0.2, 0.5);
  await click(0.8, 0.5);
  await tool("point-force");
  await click(0.4, 0.5);
  await click(0.4, 0.3);
  await tool("support");
  await sub("pin-support");
  await click(0.6, 0.5);
  await click(0.6, 0.5);
  await back();
  await safe("tree", names);

  // Clicking a load's rendered arrow must select the whole load, not a sub-element.
  await category("STATICS");
  await tool("load");
  await sub("distributed-load");
  await click(0.5, 0.5);
  await click(0.35, 0.5);
  await click(0.65, 0.5);
  await back();
  await safe("selected id after arrow click", () =>
    page.evaluate(() => {
      const sel = document.querySelector(".drawing-component-row.selected");
      return sel ? sel.querySelector("span").textContent.trim() : "none";
    }),
  );

  // Select the Beam by row, then move its body: children must follow.
  const row = page
    .locator(".drawing-component-row", { hasText: "Beam 1" })
    .first();
  await row.click({ timeout: 4000 });
  await page.waitForTimeout(300);
  await safe("beam xy before move", panelXY);
  await dragBody([0.25, 0.5], [0.25, 0.2]);
  await safe("beam xy after move", panelXY);
  await back();
  const childRow = page
    .locator(".drawing-component-row", { hasText: "Pin Support 1" })
    .first();
  await childRow.click({ timeout: 4000 });
  await page.waitForTimeout(300);
  await safe("support xy after beam move", panelXY);
  await back();

  // Feature count must equal the tree: no duplicate geometry.
  await safe("no duplicates", async () => ({
    features: await feats(),
    rows: (await names()).length,
  }));

  // Undo the move: the beam returns.
  await page
    .locator("#drawingUndo")
    .click({ timeout: 3000 })
    .catch(() => {});
  await page.waitForTimeout(300);
  const r2 = page
    .locator(".drawing-component-row", { hasText: "Beam 1" })
    .first();
  if (await r2.count()) {
    await r2.click({ timeout: 4000 });
    await page.waitForTimeout(300);
  }
  await safe("beam xy after undo", panelXY);

  return out;
}

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
  const count = () =>
    page.evaluate(
      () =>
        document.querySelectorAll("g.drawing-feature[data-feature-id]").length,
    );
  const names = () =>
    page.evaluate(() =>
      [...document.querySelectorAll(".drawing-component-row")].map((r) =>
        r.querySelector("span").textContent.trim(),
      ),
    );
  const panel = () =>
    page.evaluate(() =>
      document
        .querySelector("#drawingProperties")
        .innerText.replace(/\n+/g, " | ")
        .slice(0, 220),
    );

  await category("STATICS");

  // Varying Distributed Load, body-first.
  await tool("load");
  await sub("Varying Distributed Load");
  await safe("varying armed", () =>
    page.evaluate(() =>
      document.querySelector("#drawingToolMessage").textContent.trim(),
    ),
  );
  await tool("body");
  await sub("Beam");
  await click(0.2, 0.55);
  await click(0.8, 0.55);
  await tool("load");
  await sub("Varying Distributed Load");
  await click(0.5, 0.55);
  await click(0.35, 0.55);
  await click(0.65, 0.55);
  await safe("varying panel", panel);

  // Applied Moment, body-first.
  await tool("moment");
  await sub("Applied Moment");
  await safe("moment armed", () =>
    page.evaluate(() =>
      document.querySelector("#drawingToolMessage").textContent.trim(),
    ),
  );
  await click(0.45, 0.55);
  await safe("moment panel", panel);

  // Pin Support, body-first, then Esc mid-placement.
  await tool("support");
  await sub("Pin Support");
  await safe("support armed", () =>
    page.evaluate(() =>
      document.querySelector("#drawingToolMessage").textContent.trim(),
    ),
  );
  await click(0.6, 0.55);
  await safe("support panel", panel);

  await page
    .locator("#drawingFeaturesBack")
    .click({ timeout: 4000 })
    .catch(() => {});
  await page.waitForTimeout(250);
  await safe("tree", names);
  await safe("feature count (no duplicates)", count);

  // Esc mid-way through a new load must not create anything.
  const before = await count();
  await tool("load");
  await sub("Distributed Load");
  await click(0.5, 0.55);
  await click(0.4, 0.55);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(350);
  await safe("count after esc", async () => ({ before, after: await count() }));

  return out;
}

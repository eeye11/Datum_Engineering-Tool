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
    await page.waitForTimeout(280);
  };
  // Pick a submenu item by its exact data-submenu-id, not by text.
  const sub = async (id) => {
    await page
      .locator(`.drawing-coordinate-submenu-item[data-submenu-id="${id}"]`)
      .click({ timeout: 4000 });
    await page.waitForTimeout(300);
  };
  const msg = () =>
    page.evaluate(() =>
      document.querySelector("#drawingToolMessage").textContent.trim(),
    );
  const names = () =>
    page.evaluate(() =>
      [...document.querySelectorAll(".drawing-component-row")].map((r) => ({
        n: r.querySelector("span").textContent.trim(),
        c: r.classList.contains("drawing-component-row-child"),
      })),
    );
  const panel = () =>
    page.evaluate(() =>
      document
        .querySelector("#drawingProperties")
        .innerText.replace(/\n+/g, " | ")
        .slice(0, 200),
    );

  await category("STATICS");
  await tool("body");
  await sub("beam");
  await click(0.2, 0.55);
  await click(0.8, 0.55);

  await tool("load");
  await sub("varying-distributed-load");
  await click(0.5, 0.55);
  await click(0.35, 0.55);
  await click(0.65, 0.55);
  await safe("varying load panel", panel);

  await tool("moment");
  await sub("applied-moment");
  await click(0.45, 0.55);
  await safe("moment panel", panel);

  await tool("support");
  await sub("pin-support");
  await click(0.6, 0.55);
  await safe("support panel", panel);

  await page
    .locator("#drawingFeaturesBack")
    .click({ timeout: 4000 })
    .catch(() => {});
  await page.waitForTimeout(250);
  await safe("tree", names);
  return out;
}

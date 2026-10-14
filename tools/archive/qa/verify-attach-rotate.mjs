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
  const rows = () =>
    page.evaluate(() =>
      [...document.querySelectorAll(".drawing-component-row")].map((r) => ({
        n: r.querySelector("span").textContent.trim(),
        c: r.classList.contains("drawing-component-row-child"),
      })),
    );
  const panelOf = async (name) => {
    const r = page.locator(".drawing-component-row", { hasText: name }).first();
    if ((await r.count()) === 0) return "row not found";
    await r.click({ timeout: 4000 });
    await page.waitForTimeout(280);
    return page.evaluate(() => {
      const o = {};
      document
        .querySelectorAll("#drawingProperties .drawing-property-grid")
        .forEach((g) => {
          const k = g
            .querySelector(".drawing-property-grid-label")
            ?.textContent.trim();
          const v = g.querySelector("input,select")?.value;
          if (k && v !== undefined && /X$|Y$|Orientation|Intensity/.test(k))
            o[k] = v;
        });
      return o;
    });
  };
  const back = () =>
    page
      .locator("#drawingFeaturesBack")
      .click({ timeout: 4000 })
      .catch(() => {});

  // Beam plus a load on it.
  await category("STATICS");
  await tool("body");
  await sub("Beam");
  await click(0.2, 0.5);
  await click(0.8, 0.5);
  await tool("load");
  await sub("Distributed Load");
  await click(0.5, 0.5);
  await click(0.35, 0.5);
  await click(0.65, 0.5);

  await back();
  await page.waitForTimeout(250);
  await safe("tree", rows);
  await safe("load before rotate", () => panelOf("Distributed Load 1"));
  await back();
  await page.waitForTimeout(250);

  // Select the Beam via its own row, then rotate it.
  const beamRow = page
    .locator(".drawing-component-row", { hasText: "Beam 1" })
    .first();
  await beamRow.click({ timeout: 4000 });
  await page.waitForTimeout(300);
  await safe("beam panel", () =>
    page.evaluate(() =>
      document.querySelector("#drawingProperties").innerText.slice(0, 120),
    ),
  );

  const rot = await page.evaluate(() => {
    const c = document.querySelector(".drawing-manipulation-handle.rotation");
    if (!c) return null;
    const r = document.querySelector(".drawing-canvas").getBoundingClientRect();
    return {
      x: r.left + +c.getAttribute("cx"),
      y: r.top + +c.getAttribute("cy"),
    };
  });
  await safe("rotation handle found", () => (rot ? "yes" : "no"));
  if (rot) {
    await page.mouse.move(rot.x, rot.y);
    await page.waitForTimeout(80);
    await page.mouse.down();
    await page.waitForTimeout(80);
    await page.mouse.move(rot.x + 10, rot.y - 80, { steps: 16 });
    await page.waitForTimeout(140);
    await page.mouse.up();
    await page.waitForTimeout(450);
  }
  await safe("beam after rotate", () =>
    page.evaluate(() => {
      const o = {};
      document
        .querySelectorAll("#drawingProperties .drawing-property-grid")
        .forEach((g) => {
          const k = g
            .querySelector(".drawing-property-grid-label")
            ?.textContent.trim();
          const v = g.querySelector("input,select")?.value;
          if (k && /X$|Y$/.test(k)) o[k] = v;
        });
      return o;
    }),
  );
  await back();
  await page.waitForTimeout(250);
  await safe("load after beam rotate", () => panelOf("Distributed Load 1"));
  await safe("tree after rotate", rows);

  return out;
}

export function evalInPage(page, source) {
  return page.evaluate(
    (body) => {
      const script = document.createElement("script");
      script.textContent = body;
      document.body.appendChild(script);
      const raw = document.documentElement.getAttribute("data-qa");
      document.documentElement.removeAttribute("data-qa");
      script.remove();
      return raw ? JSON.parse(raw) : null;
    },
    `try { ${source} } catch (error) {
      document.documentElement.setAttribute("data-qa",
        JSON.stringify({ qaError: String(error && error.message || error) }));
    }`,
  );
}

export async function makeHelpers(page) {
  const tab = page.getByRole("button", { name: "Engineering Drawing" });
  if (await tab.count()) {
    await tab.first().click();
    await page.waitForTimeout(600);
  }
  await page.locator(".drawing-canvas").first().waitFor({ timeout: 15000 });

  const box = await page.locator(".drawing-canvas").first().boundingBox();
  if (!box) throw new Error("no canvas");

  const at = (fx, fy) => ({
    x: box.x + box.width * fx,
    y: box.y + box.height * fy,
  });

  const move = async (fx, fy) => {
    const p = at(fx, fy);
    await page.mouse.move(p.x, p.y);
    await page.waitForTimeout(180);
  };

  const click = async (fx, fy) => {
    const p = at(fx, fy);
    await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(300);
  };

  // A press with no movement: what a real click is.
  const press = async (fx, fy) => {
    const p = at(fx, fy);
    await page.mouse.move(p.x, p.y);
    await page.waitForTimeout(150);
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(450);
  };

  const category = async (c) => {
    await page.locator(`.drawing-category[data-category="${c}"]`).click();
    await page.waitForTimeout(250);
  };

  const tool = async (id) => {
    await page.locator(`.drawing-tool[data-tool-id="${id}"]`).click();
    await page.waitForTimeout(300);
  };

  const sub = async (label) => {
    // The submenu items only exist after the parent tool button has
    // been clicked, so make sure the menu is open before reaching
    // for the item.
    const items = page.locator(".drawing-coordinate-submenu-item");

    if ((await items.count()) === 0) {
      return;
    }

    await items.filter({ hasText: label }).first().click();
    await page.waitForTimeout(320);
  };

  const msg = () =>
    page.evaluate(() =>
      (document.querySelector("#drawingToolMessage") || {}).textContent?.trim(),
    );

  const panel = () =>
    page.evaluate(() => {
      const p = document.querySelector("#drawingProperties");
      return {
        props: p.querySelectorAll("[data-property]").length,
        keys: [...p.querySelectorAll("[data-property]")].map(
          (n) => n.dataset.property,
        ),
        text: (p.innerText || "").replace(/\n+/g, " | ").slice(0, 180),
      };
    });

  const allObjects = () =>
    evalInPage(
      page,
      [
        "var st = window.enggDrawing.state;",
        "document.documentElement.setAttribute('data-qa', JSON.stringify(",
        "  st.objects.map(function (o) {",
        "    return { id: o.id, type: o.type, parentId: o.parentId,",
        "             position: o.geometry.position,",
        "             start: o.geometry.start, end: o.geometry.end,",
        "             points: o.geometry.points,",
        "             clockwise: o.geometry.clockwise };",
        "  })));",
      ].join("\n"),
    );

  const selected = () =>
    evalInPage(
      page,
      [
        "var st = window.enggDrawing.state;",
        "var id = (st.selection && st.selection.selectedObjectIds || [])[0];",
        "var f = null;",
        "st.objects.forEach(function (o) { if (o.id === id) f = o; });",
        "document.documentElement.setAttribute('data-qa', JSON.stringify(",
        "  f ? { type: f.type, name: f.name, parentId: f.parentId,",
        "       geometry: f.geometry } : null));",
      ].join("\n"),
    );

  return {
    box,
    at,
    move,
    click,
    press,
    category,
    tool,
    sub,
    msg,
    panel,
    allObjects,
    selected,
    evalInPage,
  };
}

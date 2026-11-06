export default async function run(page, ui) {
  await page.waitForTimeout(3000);

  const found = await page.evaluate(() => {
    const list = document.getElementById("drawingObjects");
    return {
      hasHost: Boolean(list),
      text: list ? list.innerText.slice(0, 200) : null,
    };
  });

  await page.evaluate(() => {
    document.dispatchEvent(
      new CustomEvent("datum:panel-tab-changed", {
        detail: { tab: "objects" },
      }),
    );
  });

  const tabButtons = await page.evaluate(() => ({
    tabs: [...document.querySelectorAll("[data-panel-tab], [data-tab]")].map(
      (t) => ({
        key: t.dataset.panelTab || t.dataset.tab,
        label: (t.textContent || "").trim().slice(0, 30),
      }),
    ),
  }));

  // Find a way to open the Objects tab: click anything whose label is "Objects".
  const objectsTab = page.getByRole("tab", { name: /objects/i }).first();
  if (await objectsTab.count()) {
    await objectsTab.click();
    await page.waitForTimeout(800);
  }

  // Ensure the objects pane is visible before injecting a sample tree.
  const visible = await page.evaluate(() => {
    const list = document.getElementById("drawingObjects");
    if (!list) return false;
    const r = list.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  });
  if (!visible)
    return { found, tabButtons, visible, note: "objects pane not visible" };

  return await (async () => {
    // Inject a stand-in tree to test LAYOUT (this sample must never be asserted
    // on as real data; it is only to force the flex layout to compute).
    await page.evaluate(() => {
      const eye =
        '<button type="button" class="drawing-objects-visibility" data-visibility-for="x" data-visible="true" aria-pressed="true"><svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="2"/></svg></button>';
      const icon =
        '<span class="drawing-objects-icon"><svg viewBox="0 0 16 16"></svg></span>';
      document.getElementById("drawingObjects").innerHTML =
        '<div class="drawing-objects-body"><ul class="drawing-objects-list">' +
        '<li class="drawing-objects-item" data-object-id="p">' +
        icon +
        '<span class="drawing-objects-name">Pipe Assembly 1</span>' +
        eye +
        '<ul class="drawing-objects-children">' +
        '<li class="drawing-objects-item drawing-objects-item-child" data-object-id="c1">' +
        icon +
        '<span class="drawing-objects-name">Pipe Duct 1</span>' +
        eye +
        "</li>" +
        '<li class="drawing-objects-item drawing-objects-item-child" data-object-id="c2">' +
        icon +
        '<span class="drawing-objects-name">Elbow 1</span>' +
        eye +
        "</li>" +
        "</ul></li>" +
        '<li class="drawing-objects-item" data-object-id="q">' +
        icon +
        '<span class="drawing-objects-name">Another Object</span>' +
        eye +
        "</li>" +
        "</ul></div>";
    });
    await page.waitForTimeout(300);

    const boxes = await page.evaluate(() => {
      const li = document.querySelector('[data-object-id="p"]');
      const children = document.querySelector(".drawing-objects-children");
      const c1 = document.querySelector('[data-object-id="c1"]');
      const eye = li.querySelector(".drawing-objects-visibility");
      const name = li.querySelector(".drawing-objects-name");
      const r = (el) => {
        const b = el.getBoundingClientRect();
        return {
          top: Math.round(b.top),
          left: Math.round(b.left),
          w: Math.round(b.width),
          h: Math.round(b.height),
        };
      };
      return {
        row: r(li),
        rowHeight: Math.round(li.getBoundingClientRect().height),
        children: r(children),
        child1: r(c1),
        parentName: r(name),
        parentEye: r(eye),
      };
    });

    await page
      .locator("#drawingObjects")
      .screenshot({ path: ".zz-check/objects-tab.png" });
    return { found, tabButtons, visible, boxes };
  })();
}

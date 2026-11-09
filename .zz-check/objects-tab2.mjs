export default async function run(page, ui) {
  await page.waitForTimeout(2500);

  await page.locator('.tab[data-tab="drawing"]').click();
  await page.waitForTimeout(1500);

  const innerTabs = await page.evaluate(() =>
    [
      ...document.querySelectorAll(
        "#drawing [data-panel-tab], #drawing .drawing-panel-tab, .drawing-tab",
      ),
    ].map((t) => ({
      key: t.dataset.panelTab || t.dataset.tab,
      cls: t.className,
      label: (t.textContent || "").trim().slice(0, 20),
    })),
  );

  const objectsTab = page.locator('[data-panel-tab="objects"]').first();
  if (await objectsTab.count()) {
    await objectsTab.click();
    await page.waitForTimeout(600);
  }

  const state = await page.evaluate(() => {
    const list = document.getElementById("drawingObjects");
    if (!list) return { missing: true };
    const r = list.getBoundingClientRect();
    return {
      w: Math.round(r.width),
      h: Math.round(r.height),
      text: list.innerText.slice(0, 80),
    };
  });

  if (!state.w) return { innerTabs, state, note: "still hidden" };

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
    const name = li.querySelector(".drawing-objects-name");
    const eye = li.querySelector(".drawing-objects-visibility");
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
      childrenLeft: r(children).left,
      parentName: r(name),
      parentEye: r(eye),
      notes: {
        rowHeight: Math.round(li.getBoundingClientRect().height),
        childrenBelowParentName:
          children.getBoundingClientRect().top >=
          name.getBoundingClientRect().bottom - 1,
        child1Top: r(c1).top,
      },
    };
  });

  await page
    .locator("#drawingObjects")
    .screenshot({ path: ".zz-check/objects-tab.png" });
  return { innerTabs, state, boxes };
}

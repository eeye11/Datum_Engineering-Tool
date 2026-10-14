/*
 * Check the two things the user asked for about the hide control: that the
 * toolset bar hides itself, and that the Show control appears in the same
 * place, not blocked by anything.
 */
export default async function run(page, ui) {
  await page.getByRole("button", { name: "Engineering Drawing" }).click();
  await page.waitForTimeout(400);

  const before = await page.evaluate(() => {
    const hide = document.getElementById("headerHideButton");
    const r = hide.getBoundingClientRect();
    return {
      hideVisible: r.width > 0 && r.height > 0,
      hideRect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      toolsetHeight: Math.round(document.querySelector(".drawing-toolbar").getBoundingClientRect().height),
      title: document.querySelector(".drawing-toolbar .drawing-workspace-title")?.textContent ?? null,
    };
  });

  await page.locator("#headerHideButton").click();
  await page.waitForTimeout(300);

  const after = await page.evaluate(() => {
    const show = document.getElementById("drawingTopBarShow");
    const r = show.getBoundingClientRect();
    const topEl = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return {
      toolsetDisplay: getComputedStyle(document.querySelector(".drawing-toolbar")).display,
      stripDisplay: getComputedStyle(document.querySelector(".drawing-style-strip")).display,
      menubarDisplay: getComputedStyle(document.querySelector(".datum-menubar")).display,
      showVisible: r.width > 0 && r.height > 0,
      showRect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      topElementAtShowCentre: topEl?.id || topEl?.className || topEl?.tagName,
    };
  });

  await page.locator("#drawingTopBarShow").click();
  await page.waitForTimeout(300);

  const restored = await page.evaluate(() => ({
    toolsetDisplay: getComputedStyle(document.querySelector(".drawing-toolbar")).display,
    stripDisplay: getComputedStyle(document.querySelector(".drawing-style-strip")).display,
    showHidden: document.getElementById("drawingTopBarShow").hidden,
  }));

  return { before, after, restored };
}

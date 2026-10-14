export default async function run(page, ui) {
  const results = {};

  const popupCount = () =>
    page.evaluate(
      () => document.querySelectorAll(".drawing-creation-dimension").length,
    );

  let snap = await ui.snapshot();

  const loadsMenu = snap.match(/@(e\d+) button "Loads"/)?.[1];

  if (loadsMenu) {
    await ui.click(loadsMenu);
    await page.waitForTimeout(600);
    snap = await ui.snapshot();
  }

  results.menuSnapshot = snap.split("\n").slice(0, 40).join("\n");

  const loadButton = snap.match(/@(e\d+) button "Distributed Load"/)?.[1];
  results.foundLoadButton = Boolean(loadButton);

  if (!loadButton) {
    return results;
  }

  await ui.click(loadButton);
  await page.waitForTimeout(400);

  const box = await page.evaluate(() => {
    const c = document.querySelector("canvas");
    if (!c) return null;
    const r = c.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });

  results.box = box;

  if (!box) return results;

  const at = (fx, fy) => ({
    x: box.x + box.width * fx,
    y: box.y + box.height * fy,
  });

  const start = at(0.3, 0.5);
  const end = at(0.6, 0.5);

  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(400);

  results.popupAfterSpanDrag = await popupCount();

  const loadPoint = at(0.5, 0.3);
  await page.mouse.move(loadPoint.x, loadPoint.y);
  await page.waitForTimeout(150);

  results.popupAfterMove = await popupCount();

  await page.mouse.click(loadPoint.x, loadPoint.y);
  await page.waitForTimeout(400);

  results.popupAfterLoadClick = await popupCount();
  results.popupAfterLoadClickText = await page.evaluate(
    () =>
      document.querySelector(".drawing-creation-dimension")?.innerText || null,
  );

  return results;
}

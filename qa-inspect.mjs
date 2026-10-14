/*
 * Create a Pipe / Duct in the running app and dump the property panel markup.
 */
export default async function run(page, ui) {
  const snap = await ui.snapshot();
  const drawing = snap.match(/@(e\d+) button "Engineering Drawing"/)?.[1];
  if (drawing) {
    await ui.click(drawing);
    await page.waitForTimeout(600);
  }

  let snap2 = await ui.snapshot();
  const pipe = snap2.match(/@(e\d+) button "Pipe \/ Duct"/)?.[1];
  if (pipe) {
    await ui.click(pipe);
    await page.waitForTimeout(400);
  }

  const canvas = page.locator('canvas').first();
  const box = await canvas.boundingBox();
  if (!box) return { error: 'no canvas' };

  const x0 = box.x + 120;
  const y0 = box.y + 120;
  const x1 = box.x + 360;
  const y1 = box.y + 120;

  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.waitForTimeout(120);
  await page.mouse.move(x1, y1, { steps: 12 });
  await page.waitForTimeout(120);
  await page.mouse.up();
  await page.waitForTimeout(500);

  const snap3 = await ui.snapshot();

  const html = await page.evaluate(() => {
    const panel = document.querySelector('.drawing-properties-panel') ||
      document.querySelector('#drawing-properties') ||
      document.querySelector('[class*="drawing-propert"]');
    return panel ? panel.outerHTML : 'NO PANEL FOUND: ' + document.body.innerHTML.slice(0, 800);
  });

  return {
    snap: snap3.slice(0, 3000),
    panelHtml: html.slice(0, 14000),
  };
}

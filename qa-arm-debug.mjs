export default async function run(page, ui) {
  await page.waitForTimeout(1000);
  await page.evaluate(() => {
    [...document.querySelectorAll("button")]
      .find((b) => b.textContent.trim() === "Engineering Drawing")
      ?.click();
  });
  await page.waitForTimeout(900);
  await page.evaluate(() => {
    document
      .querySelector('.drawing-category[data-category="FLUIDS"]')
      ?.click();
  });
  await page.waitForTimeout(500);

  const readActive = () =>
    page.evaluate(async () => {
      const mod = await import("/src/editor/editor-state.js");
      const s = mod.drawingState || mod.default;
      return {
        activeTool: s.activeTool,
        fluidsTool: s.interaction.fluidsTool,
        phase: s.interaction.phase,
        msg: document.querySelector("#drawingToolMessage")?.textContent?.trim(),
        pipeBtnActive: document
          .querySelector('.drawing-tool[data-tool-id="pipe-duct"]')
          ?.classList.contains("active"),
      };
    });

  const out = {};
  out.beforeClick = await readActive();

  await page.evaluate(() => {
    document.querySelector('.drawing-tool[data-tool-id="pipe-duct"]')?.click();
  });
  await page.waitForTimeout(300);
  out.afterClick = await readActive();

  // Now try a real pointer down+move+up on the canvas.
  const box = await page.evaluate(() => {
    const b = document
      .querySelector(".drawing-canvas svg")
      .getBoundingClientRect();
    return { x: b.x, y: b.y, w: b.width, h: b.height };
  });
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;

  await page.mouse.move(cx - 150, cy);
  await page.waitForTimeout(60);
  await page.mouse.down();
  await page.waitForTimeout(60);
  out.afterDown = await readActive();
  await page.mouse.move(cx + 50, cy, { steps: 8 });
  await page.waitForTimeout(120);
  out.duringDrag = await readActive();
  await page.mouse.up();
  await page.waitForTimeout(250);
  out.afterUp = await readActive();

  out.objects = await page.evaluate(async () => {
    const mod = await import("/src/editor/editor-state.js");
    const s = mod.drawingState || mod.default;
    return (s.objects || []).map((o) => ({ type: o.type, name: o.name }));
  });

  return out;
}

/*
 * Does the drag technique itself create a Line in GEOMETRY? Then: does the same
 * drag with the Fluids Pipe / Duct armed create one too?
 */
export default async function run(page, ui) {
  await page.waitForFunction(
    () => document.querySelectorAll(".drawing-category").length > 0,
    { timeout: 20000 },
  );

  await page.evaluate(() => {
    document.querySelector('.tab[data-tab="drawing"]')?.click();
  });
  await page.waitForFunction(
    () => {
      const c = document.querySelector(".drawing-canvas");
      return Boolean(c) && c.getBoundingClientRect().width > 0;
    },
    { timeout: 20000 },
  );

  const count = () =>
    page.evaluate(
      () =>
        document.querySelectorAll(".drawing-canvas [data-feature-id]").length,
    );

  const state = () =>
    page.evaluate(() => ({
      highlighted:
        document.querySelector(".drawing-tool.active")?.dataset.toolId || null,
      message:
        document.querySelector("#drawingToolMessage")?.textContent?.trim() ||
        "",
    }));

  const category = (cat) =>
    page.evaluate((c) => {
      [...document.querySelectorAll(".drawing-category")]
        .find((el) => el.dataset.category === c)
        ?.click();
    }, cat);

  const tool = (id) =>
    page.evaluate((t) => {
      document.querySelector(`.drawing-tool[data-tool-id="${t}"]`)?.click();
    }, id);

  const drag = async (x1, y1, x2, y2) => {
    const box = await (await page.$(".drawing-canvas")).boundingBox();
    const px = (f) => box.x + box.width * f;
    const py = (f) => box.y + box.height * f;
    await page.mouse.move(px(x1), py(y1));
    await page.mouse.down();
    await page.mouse.move(px((x1 + x2) / 2), py((y1 + y2) / 2), { steps: 8 });
    await page.mouse.move(px(x2), py(y2), { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(200);
  };

  /* --- GEOMETRY: a plain Line, as a control --- */
  await category("GEOMETRY");
  await tool("line");
  const lineState = await state();
  const beforeLine = await count();
  await drag(0.2, 0.2, 0.45, 0.2);
  const afterLine = await count();

  /* --- FLUIDS: a Pipe / Duct --- */
  await category("FLUIDS");
  await tool("pipe-duct");
  const pipeState = await state();
  const beforePipe = await count();
  await drag(0.2, 0.5, 0.45, 0.5);
  const afterPipe = await count();

  await tool("select");

  return {
    control: { lineState, beforeLine, afterLine },
    fluids: { pipeState, beforePipe, afterPipe },
  };
}

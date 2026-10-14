export default async function run(page, ui) {
  await page.waitForTimeout(1200);
  await page.getByRole("button", { name: "Engineering Drawing" }).click();
  await page.waitForTimeout(800);

  const out = {};

  await page.evaluate(() => {
    [...document.querySelectorAll("button")]
      .find((b) => b.textContent.trim() === "FLUIDS")
      ?.click();
  });
  await page.waitForTimeout(400);
  const snap = await ui.snapshot();
  const pipeBtn = snap.match(/@(e\d+) button "Pipe \/ Duct/)?.[1];
  if (pipeBtn) await ui.click(pipeBtn);
  await page.waitForTimeout(400);

  out.afterArm = await page.evaluate(async () => {
    const s = (await import("/src/editor/editor-state.js")).drawingState;
    return { activeTool: s.activeTool, fluidsTool: s.interaction.fluidsTool };
  });

  const box = await page.evaluate(() => {
    const b = document
      .querySelector(".drawing-canvas svg")
      .getBoundingClientRect();
    return { x: b.x, y: b.y, w: b.width, h: b.height };
  });
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;

  // What is under the press point?
  out.elementAtPress = await page.evaluate(
    ({ x, y }) => {
      const el = document.elementFromPoint(x, y);
      return {
        tag: el?.tagName,
        cls: el?.getAttribute?.("class"),
        inCanvas: Boolean(
          document.querySelector(".drawing-canvas")?.contains(el),
        ),
      };
    },
    { x: cx - 200, y: cy },
  );

  await page.mouse.move(cx - 200, cy);
  await page.waitForTimeout(100);
  await page.mouse.down();
  await page.waitForTimeout(150);
  out.afterDown = await page.evaluate(async () => {
    const s = (await import("/src/editor/editor-state.js")).drawingState;
    const e = (await import("/src/editor/editor-state.js")).editorState;
    return {
      activeTool: s.activeTool,
      fluidsTool: s.interaction.fluidsTool,
      creationDrag: e.creationDrag
        ? {
            pipeDuct: e.creationDrag.pipeDuct,
            moved: e.creationDrag.moved,
            start: e.creationDrag.start,
          }
        : null,
    };
  });
  await page.mouse.up();
  await page.waitForTimeout(200);

  return out;
}

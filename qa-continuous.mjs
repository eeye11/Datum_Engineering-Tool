/*
 * Reproduce and verify the continuous Pipe / Duct workflow in the real app.
 * Reads the live drawingState so we see the actual model, not a guess.
 */
const readState = (page) =>
  page.evaluate(async () => {
    try {
      const mod = await import("/src/editor/editor-state.js");
      const s = mod.drawingState || mod.default;
      const e = mod.editorState;
      return {
        activeTool: s?.activeTool,
        interaction: s?.interaction
          ? JSON.parse(
              JSON.stringify({
                phase: s.interaction.phase,
                fluidsTool: s.interaction.fluidsTool,
                routeCommittedCount: s.interaction.routeCommittedCount,
                routeSegmentStart: s.interaction.routeSegmentStart,
              }),
            )
          : null,
        objectCount: s?.objects?.length ?? null,
        objects: (s?.objects || []).map((o) => ({
          type: o.type,
          name: o.name,
          geometry: o.geometry,
          engineering: o.engineering
            ? { shape: o.engineering.shape, angle: o.engineering.angle, bendRadius: o.engineering.bendRadius }
            : null,
        })),
        creationDrag: e?.creationDrag
          ? { pipeDuct: e.creationDrag.pipeDuct, moved: e.creationDrag.moved }
          : null,
      };
    } catch (err) {
      return { error: String(err).slice(0, 400) };
    }
  });

export default async function run(page, ui) {
  await page.waitForTimeout(1000);

  // Open the Engineering Drawing workspace.
  await page.evaluate(() => {
    [...document.querySelectorAll("button")]
      .find((b) => b.textContent.trim() === "Engineering Drawing")
      ?.click();
  });
  await page.waitForTimeout(800);

  // Switch to FLUIDS toolset.
  await page.evaluate(() => {
    document.querySelector('.drawing-category[data-category="FLUIDS"]')?.click();
  });
  await page.waitForTimeout(500);

  const out = { steps: [] };

  const box = await page.evaluate(() => {
    const b = document.querySelector(".drawing-canvas svg").getBoundingClientRect();
    return { x: b.x, y: b.y, w: b.width, h: b.height };
  });
  out.box = box;
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;

  const drag = async (x1, y1, x2, y2, label) => {
    await page.mouse.move(x1, y1);
    await page.waitForTimeout(80);
    await page.mouse.down();
    await page.waitForTimeout(80);
    await page.mouse.move(x2, y2, { steps: 12 });
    await page.waitForTimeout(120);
    const during = await readState(page);
    await page.mouse.up();
    await page.waitForTimeout(250);
    const after = await readState(page);
    out.steps.push({ label, during: during.objects, after: after.objects, interaction: after.interaction, activeTool: after.activeTool });
  };

  // Arm Pipe / Duct.
  await page.evaluate(() => {
    document.querySelector('.drawing-tool[data-tool-id="pipe-duct"]')?.click();
  });
  await page.waitForTimeout(400);
  out.armed = await readState(page);
  out.armMsg = await page.evaluate(
    () => document.querySelector("#drawingToolMessage")?.textContent?.trim() || null,
  );

  // Leg 1: horizontal.
  await drag(cx - 220, cy, cx - 40, cy, "leg1-horizontal");

  // Leg 2: continue from previous endpoint, go vertical (90 deg elbow).
  await drag(cx - 40, cy, cx - 40, cy - 160, "leg2-vertical-90");

  // Leg 3: diagonal (45 deg elbow).
  await drag(cx - 40, cy - 160, cx + 120, cy - 320, "leg3-diagonal-45");

  // Leg 4: continue horizontally without reselecting tool.
  await drag(cx + 120, cy - 320, cx + 280, cy - 320, "leg4-horizontal");

  out.final = await readState(page);

  // Finish the run with Enter.
  await page.keyboard.press("Enter");
  await page.waitForTimeout(250);
  out.afterEnter = await readState(page);

  return out;
}

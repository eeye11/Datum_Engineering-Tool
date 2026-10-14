export default async function run(page, ui) {
  await page.waitForTimeout(1200);
  await page.getByRole("button", { name: "Engineering Drawing" }).click();
  await page.waitForTimeout(800);

  const out = {};
  const snap0 = await ui.snapshot();
  out.snap0 = snap0.split("\n").filter((l) => /FLUIDS|Pipe|Elbow/i.test(l));
  const fluidsBtn = snap0.match(/@(e\d+) button "FLUIDS"/)?.[1];
  if (fluidsBtn) await ui.click(fluidsBtn);
  await page.waitForTimeout(400);
  const snap1 = await ui.snapshot();
  const pipeBtn = snap1.match(/@(e\d+) button "Pipe \/ Duct/)?.[1];
  out.pipeBtn = pipeBtn;
  if (pipeBtn) await ui.click(pipeBtn);
  await page.waitForTimeout(400);

  out.statusAfterArm = await page.evaluate(
    () => document.getElementById("drawingToolMessage")?.textContent?.trim() || null,
  );

  const box = await page.evaluate(() => {
    const b = document.querySelector(".drawing-canvas svg").getBoundingClientRect();
    return { x: b.x, y: b.y, w: b.width, h: b.height };
  });
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  out.box = box;

  const readInteraction = () =>
    page.evaluate(async () => {
      try {
        const mod = await import("/src/editor/editor-state.js");
        const s = mod.drawingState || mod.default;
        const e = mod.editorState;
        return {
          activeTool: s.activeTool,
          phase: s.interaction?.phase,
          routeSegmentStart: s.interaction?.routeSegmentStart,
          fluidsTool: s.interaction?.fluidsTool,
          preview: s.interaction?.preview
            ? { type: s.interaction.preview.type, geometry: s.interaction.preview.geometry }
            : null,
          creationDrag: e?.creationDrag
            ? { pipeDuct: e.creationDrag.pipeDuct, moved: e.creationDrag.moved, start: e.creationDrag.start }
            : null,
        };
      } catch (err) {
        return { error: String(err).slice(0, 300) };
      }
    });

  const readSvg = () =>
    page.evaluate(() => {
      const svg = document.querySelector(".drawing-canvas svg");
      if (!svg) return "no svg";
      return [...svg.querySelectorAll("path,line,polyline,circle,rect")].map((s) => ({
        tag: s.tagName,
        d: (s.getAttribute("d") || s.getAttribute("points") || "").slice(0, 90),
        cls: s.getAttribute("class"),
        x1: s.getAttribute("x1"),
        y1: s.getAttribute("y1"),
        x2: s.getAttribute("x2"),
        y2: s.getAttribute("y2"),
      }));
    });

  // PRESS-HOLD-DRAG-RELEASE gesture.
  await page.mouse.move(cx - 200, cy);
  await page.waitForTimeout(100);
  await page.mouse.down();
  await page.waitForTimeout(150);
  out.afterDown = await readInteraction();
  await page.mouse.move(cx - 60, cy, { steps: 12 });
  await page.waitForTimeout(250);
  out.interactionDrag = await readInteraction();
  out.duringDrag = await readSvg();
  await page.mouse.move(cx + 120, cy, { steps: 12 });
  await page.waitForTimeout(250);
  out.interactionDrag2 = await readInteraction();
  out.duringDrag2 = await readSvg();
  await page.mouse.up();
  await page.waitForTimeout(350);
  out.afterRelease = await readSvg();
  out.statusAfterRelease = await page.evaluate(
    () => document.getElementById("drawingToolMessage")?.textContent?.trim() || null,
  );

  // Live interaction state.
  out.state = await page.evaluate(async () => {
    try {
      const mod = await import("/src/editor/editor-state.js");
      const s = mod.drawingState || mod.default;
      return {
        found: true,
        interaction: s?.interaction ? JSON.parse(JSON.stringify(s.interaction)) : null,
        objectCount: s?.objects?.length ?? null,
        objects: (s?.objects || []).map((o) => ({
          type: o.type,
          name: o.name,
          geometry: o.geometry,
          engineering: o.engineering,
        })),
      };
    } catch (e) {
      return { found: false, error: String(e).slice(0, 300) };
    }
  });

  return out;
}

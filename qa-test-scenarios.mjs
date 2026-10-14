export default async function run(page, ui) {
  // Ensure main.js is loaded
  await page.evaluate(async () => {
    if (!window.enggDrawing) await import("/src/main.js");
  });
  await page.waitForFunction(() => !!window.enggDrawing);
  await page.waitForTimeout(400);

  // Switch to Engineering Drawing
  await page.getByRole("button", { name: "Engineering Drawing" }).click();
  await page.waitForTimeout(400);

  // Switch to FLUIDS
  await page.evaluate(() => {
    [...document.querySelectorAll("button")]
      .find((b) => b.textContent.trim() === "FLUIDS")
      ?.click();
  });
  await page.waitForTimeout(300);

  const snap = await ui.snapshot();
  const pipeBtn = snap.match(/@(e\d+) button "Pipe \/ Duct/)?.[1];
  if (pipeBtn) await ui.click(pipeBtn);
  await page.waitForTimeout(300);

  const out = {};

  const box = await page.evaluate(() => {
    const b = document
      .querySelector(".drawing-canvas svg")
      .getBoundingClientRect();
    return { x: b.x, y: b.y, w: b.width, h: b.height };
  });
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;

  // Test 1: Draw horizontal segment
  // Press at (cx - 150, cy), drag to (cx, cy), release
  await page.mouse.move(cx - 150, cy);
  await page.waitForTimeout(100);
  await page.mouse.down();
  await page.waitForTimeout(100);
  await page.mouse.move(cx, cy, { steps: 8 });
  await page.waitForTimeout(150);

  out.t1_duringDrag = await page.evaluate(() => ({
    preview: window.enggDrawing.state.interaction?.preview,
    interactionPhase: window.enggDrawing.state.interaction?.phase,
    creationDrag: !!window.enggEditorState?.creationDrag,
    svgLines: document.querySelectorAll(".drawing-canvas svg line").length,
  }));

  await page.mouse.up();
  await page.waitForTimeout(300);

  out.t1_afterRelease = await page.evaluate(() => ({
    objectCount: window.enggDrawing.state.objects.length,
    objects: window.enggDrawing.state.objects.map((o) => ({
      type: o.type,
      name: o.name,
      id: o.id,
    })),
    featuresTreeRows: [
      ...document.querySelectorAll(".drawing-component-row"),
    ].map((r) => r.textContent.trim()),
    preview: window.enggDrawing.state.interaction?.preview,
    message: document.getElementById("drawingToolMessage")?.textContent?.trim(),
  }));

  // Test 2: Draw second segment (connected)
  // Press at (cx, cy) and drag to (cx, cy + 100)
  await page.mouse.move(cx, cy);
  await page.waitForTimeout(100);
  await page.mouse.down();
  await page.waitForTimeout(100);
  await page.mouse.move(cx, cy + 100, { steps: 8 });
  await page.waitForTimeout(150);

  out.t2_duringDrag = await page.evaluate(() => ({
    preview: window.enggDrawing.state.interaction?.preview,
    previousRun: window.enggDrawing.state.interaction?.previousRun?.name,
    objectCount: window.enggDrawing.state.objects.length,
  }));

  await page.mouse.up();
  await page.waitForTimeout(300);

  out.t2_afterRelease = await page.evaluate(() => ({
    objectCount: window.enggDrawing.state.objects.length,
    objects: window.enggDrawing.state.objects.map((o) => ({
      type: o.type,
      name: o.name,
      id: o.id,
    })),
    featuresTreeRows: [
      ...document.querySelectorAll(".drawing-component-row"),
    ].map((r) => r.textContent.trim()),
    message: document.getElementById("drawingToolMessage")?.textContent?.trim(),
  }));

  // Test 3: Release pointer OUTSIDE canvas
  // Press at (cx, cy + 100) and drag to (box.x - 50, cy + 100) outside canvas
  await page.mouse.move(cx, cy + 100);
  await page.waitForTimeout(100);
  await page.mouse.down();
  await page.waitForTimeout(100);
  await page.mouse.move(box.x - 50, cy + 100, { steps: 8 });
  await page.waitForTimeout(150);
  await page.mouse.up();
  await page.waitForTimeout(300);

  out.t3_outsideRelease = await page.evaluate(() => ({
    objectCount: window.enggDrawing.state.objects.length,
    objects: window.enggDrawing.state.objects.map((o) => ({
      type: o.type,
      name: o.name,
      id: o.id,
    })),
  }));

  return out;
}

export default async function run(page, ui) {
  await page.waitForTimeout(1000);
  await page.getByRole("button", { name: "Engineering Drawing" }).click();
  await page.waitForTimeout(600);

  const out = {};
  const snap0 = await ui.snapshot();
  const fluidsBtn = snap0.match(/@(e\d+) button "FLUIDS"/)?.[1];
  await ui.click(fluidsBtn);
  await page.waitForTimeout(500);

  const snap2 = await ui.snapshot();
  const pipeBtn = snap2.match(/@(e\d+) button "Pipe \/ Duct/)?.[1];
  await ui.click(pipeBtn);
  await page.waitForTimeout(400);

  const svgBox = await page.evaluate(() => {
    const svg = document.querySelector(".drawing-canvas svg");
    const b = svg.getBoundingClientRect();
    return { x: b.x, y: b.y, width: b.width, height: b.height };
  });
  out.svg = svgBox;

  const cx = svgBox.x + svgBox.width / 2;
  const cy = svgBox.y + svgBox.height / 2;
  const routeShapes = () =>
    page.evaluate(() => {
      const svg = document.querySelector(".drawing-canvas svg");
      return [...svg.querySelectorAll("polyline")]
        .map((p) => p.getAttribute("points"))
        .filter(Boolean);
    });

  const drawRoute = async (points, finishKey = "Enter") => {
    for (const [x, y] of points) {
      await page.mouse.click(x, y);
      await page.waitForTimeout(200);
    }
    const during = await routeShapes();
    await page.keyboard.press(finishKey);
    await page.waitForTimeout(350);
    const after = await routeShapes();
    return { during, after, status: await page.evaluate(() => document.getElementById("drawingToolMessage")?.textContent?.trim()) };
  };

  const armPipe = async () => {
    const s = await ui.snapshot();
    const f = s.match(/@(e\d+) button "FLUIDS"/)?.[1];
    const p = s.match(/@(e\d+) button "Pipe \/ Duct/)?.[1];
    if (f) await ui.click(f);
    await page.waitForTimeout(300);
    const s2 = await ui.snapshot();
    const p2 = s2.match(/@(e\d+) button "Pipe \/ Duct/)?.[1] || p;
    await ui.click(p2);
    await page.waitForTimeout(300);
  };

  const arm = armPipe;

  // 1. Straight horizontal route (2 points).
  await arm();
  out.horizontal = await drawRoute([[cx - 250, cy - 150], [cx + 100, cy - 150]]);

  // 2. Straight vertical route.
  await arm();
  out.vertical = await drawRoute([[cx + 250, cy - 150], [cx + 250, cy + 100]]);

  // 3. 90-degree corner route.
  await arm();
  out.corner90 = await drawRoute([
    [cx - 250, cy + 100],
    [cx - 100, cy + 100],
    [cx - 100, cy - 50],
  ]);

  // 4. Multi-segment with a 45-degree corner (moves of 100,100 then 100,0).
  await arm();
  out.multi45 = await drawRoute([
    [cx - 250, cy + 150],
    [cx - 150, cy + 250],
    [cx - 50, cy + 250],
    [cx + 50, cy + 250],
  ]);

  // 5. Route snapped onto an existing endpoint (the end of route 1's horizontal).
  await arm();
  out.snapTest = await drawRoute([
    [cx - 300, cy - 220],
    [cx + 100, cy - 150], // exactly route 1's end point
    [cx + 150, cy - 150],
  ]);

  // 6. Escape cancellation leaves nothing.
  await arm();
  await page.mouse.click(cx, cy);
  await page.waitForTimeout(200);
  await page.mouse.click(cx + 60, cy);
  await page.waitForTimeout(200);
  const beforeEscape = await routeShapes();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  const afterEscape = await routeShapes();
  out.cancel = { beforeEscapeCount: beforeEscape.length, afterEscapeCount: afterEscape.length, status: await page.evaluate(() => document.getElementById("drawingToolMessage")?.textContent?.trim()) };

  // Persistence: save then reload via localStorage-backed document.
  out.saveStatus = await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) => /^save$/i.test(b.textContent.trim()));
    return btn ? btn.textContent.trim() : "no save button";
  });

  // Reload the page and re-open the drawing to check persistence.
  const afterRender = await routeShapes();
  out.finalPolylines = afterRender.length;
  out.pointsBeforeReload = afterRender;

  await page.reload();
  await page.waitForTimeout(2000);
  await page.evaluate(() => {
    [...document.querySelectorAll("button")].find((b) => /engineering drawing/i.test(b.textContent))?.click();
  });
  await page.waitForTimeout(800);
  out.pointsAfterReload = await routeShapes();
  out.treeAfterReload = await page.evaluate(() => {
    const t = document.querySelector("#featureTree, [id*=feature], [class*=feature-tree]");
    return t ? t.textContent.slice(0, 400) : null;
  });

  return out;
}

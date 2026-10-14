export default async function run(page, ui) {
  await page.waitForTimeout(1000);
  await page.getByRole("button", { name: "Engineering Drawing" }).click();
  await page.waitForTimeout(600);

  await page.waitForTimeout(400);

  const out = {};
  const snap0 = await ui.snapshot();
  const fluidsBtn = snap0.match(/@(e\d+) button "FLUIDS"/)?.[1];
  if (fluidsBtn) await ui.click(fluidsBtn);
  await page.waitForTimeout(500);

  const snap2 = await ui.snapshot();
  const pipeBtn = snap2.match(/@(e\d+) button "Pipe \/ Duct/)?.[1];
  out.fluidsSnap = snap2.split("\n").filter((l) => /Pipe|Elbow|Junction/i.test(l));
  out.pipeBtn = pipeBtn;
  if (!pipeBtn) return { out, snap: await ui.snapshot() };
  await ui.click(pipeBtn);
  await page.waitForTimeout(400);

  out.statusAfterArm = await page.evaluate(
    () => document.getElementById("drawingToolMessage")?.textContent?.trim() || null,
  );

  const canvasEl = await page.evaluateHandle(() => {
    const svgs = [...document.querySelectorAll("#drawing svg")];
    return svgs.sort((a, b) => b.getBoundingClientRect().width * b.getBoundingClientRect().height - a.getBoundingClientRect().width * a.getBoundingClientRect().height)[0];
  });
  const box = (await canvasEl.evaluate((el) => { const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height }; }));
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  // Route: start, right (H), up (V), 45° corner, horizontal.
  const pts = [
    [cx - 200, cy + 120],
    [cx - 20, cy + 120],
    [cx - 20, cy - 20],
    [cx + 80, cy - 120],
    [cx + 200, cy - 120],
  ];
  for (const [x, y] of pts) {
    await page.mouse.click(x, y);
    await page.waitForTimeout(250);
  }

  // Live preview present before finishing?
  out.shapesBeforeFinish = await page.evaluate(() => {
    const svg = document.querySelector(".drawing-canvas svg");
    if (!svg) return null;
    return [...svg.querySelectorAll("path,line,polyline,circle")].length;
  });

  await page.keyboard.press("Enter");
  await page.waitForTimeout(500);

  out.statusAfterFinish = await page.evaluate(
    () => document.getElementById("drawingToolMessage")?.textContent?.trim() || null,
  );

  out.render = await page.evaluate(() => {
    const svg = document.querySelector(".drawing-canvas svg");
    if (!svg) return "no svg";
    return [...svg.querySelectorAll("path,line,polyline,circle")].map((s) => ({
      tag: s.tagName,
      d: (s.getAttribute("d") || s.getAttribute("points") || "").slice(0, 100),
      cls: s.getAttribute("class"),
    }));
  });

  out.tree = await page.evaluate(() => {
    const tree = document.querySelector("[class*=feature-tree], [class*=tree]");
    return tree ? tree.textContent.slice(0, 500) : null;
  });

  return out;
}

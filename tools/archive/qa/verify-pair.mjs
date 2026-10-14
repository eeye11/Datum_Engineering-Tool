export default async function run(page, ui) {
  const errs = [];
  page.on("pageerror", (e) =>
    errs.push("PAGEERROR: " + e.message.slice(0, 200)),
  );
  page.on("console", (m) => {
    if (m.type() === "error") errs.push("CONSOLE: " + m.text().slice(0, 160));
  });

  await page.goto("http://localhost:8099/", { waitUntil: "load" });
  await page.waitForTimeout(2000);
  const tab = page
    .locator("button", { hasText: "Engineering Drawing" })
    .first();
  if (await tab.count()) await tab.click();
  await page.waitForTimeout(1500);

  const b = await page.locator(".drawing-workspace").first().boundingBox();
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  const msg = () =>
    page.evaluate(
      () => document.getElementById("drawingToolMessage")?.textContent,
    );

  const out = { errs };

  // Two lines at different angles, so the pair has a real angle between them.
  await page.locator('button[data-category="GEOMETRY"]').click();
  await page.waitForTimeout(400);
  const drawLine = async (x1, y1, x2, y2) => {
    await page.locator('#drawingToolList [data-tool-id="line"]').click();
    await page.waitForTimeout(250);
    await page.mouse.click(cx + x1, cy + y1);
    await page.waitForTimeout(200);
    await page.mouse.click(cx + x2, cy + y2);
    await page.waitForTimeout(600);
  };

  await drawLine(-220, -120, 0, 0);
  await drawLine(-220, 120, 0, 0);

  // Select BOTH lines with the Select tool.
  await page
    .locator('#drawingGlobalToolGroups [data-tool-id="select"]')
    .click();
  await page.waitForTimeout(300);
  await page.mouse.click(cx - 140, cy - 90); // on the upper line
  await page.waitForTimeout(300);
  await page.mouse.click(cx - 140, cy + 90, { modifiers: ["Shift"] }); // add the lower
  await page.waitForTimeout(400);
  out.selection = await page.evaluate(() => {
    const s = document.createElement("script");
    s.textContent =
      "document.documentElement.setAttribute('data-n'," +
      " String(window.enggDrawing.state.selection.selectedObjectIds.length));";
    document.body.appendChild(s);
    return null;
  });
  out.selectedCount = await page.getAttribute("html", "data-n");

  // Now Smart Dimension on the pair.
  await page.locator('button[data-category="ANNOTATE"]').click();
  await page.waitForTimeout(400);
  await page
    .locator('#drawingToolList [data-tool-id="smart-dimension"]')
    .click();
  await page.waitForTimeout(250);
  await page.mouse.click(cx + 60, cy - 30); // click to arm the pair measurement
  await page.waitForTimeout(600);
  out.armedMsg = await msg();
  out.previewText = await page.evaluate(() =>
    [...document.querySelectorAll(".drawing-dimension-preview text")].map((t) =>
      t.textContent.trim(),
    ),
  );

  // Place it.
  await page.mouse.move(cx + 40, cy - 190);
  await page.waitForTimeout(300);
  await page.mouse.click(cx + 40, cy - 190);
  await page.waitForTimeout(700);
  out.placedMsg = await msg();
  out.placedRefs = await page
    .evaluate(() => {
      const s = document.createElement("script");
      s.textContent = `
      (function(){
        const st = window.enggDrawing.state;
        const d = st.objects.find(o => o.type === 'dimension');
        document.documentElement.setAttribute('data-r', JSON.stringify({
          type: d && d.dimensionType,
          refs: d && d.sourceRefs,
          value: d ? window.enggDimensionModel.formatMeasurement(d, st) : null
        }));
      })();`;
      document.body.appendChild(s);
      return null;
    })
    .then(() => page.getAttribute("html", "data-r"))
    .then((v) => JSON.parse(v || "null"));

  return out;
}

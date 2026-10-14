export default async function run(page, ui) {
  const errs = [];
  page.on("pageerror", (e) => errs.push("PAGEERROR: " + e.message.slice(0, 200)));
  page.on("console", (m) => {
    if (m.type() === "error") errs.push("CONSOLE: " + m.text().slice(0, 160));
  });

  await page.goto("http://localhost:8099/", { waitUntil: "load" });
  await page.waitForTimeout(2000);
  const tab = page.locator("button", { hasText: "Engineering Drawing" }).first();
  if (await tab.count()) await tab.click();
  await page.waitForTimeout(1500);

  const out = { errs };
  const bb = await page.locator(".drawing-canvas").first().boundingBox();
  const msg = () =>
    page.evaluate(() => document.getElementById("drawingToolMessage")?.textContent);

  let seq = 0;
  const inPage = (lines) => {
    seq += 1;
    const key = "data-s" + seq;
    return page
      .evaluate((src) => {
        const s = document.createElement("script");
        s.textContent = src;
        document.body.appendChild(s);
        return null;
      }, "(function(){\n" + lines.join("\n").split("__K__").join(key) + "\n})();")
      .then(() => page.getAttribute("html", key))
      .then((v) => (v === null ? null : JSON.parse(v)));
  };

  const selectTool = async () => {
    const tool = await inPage([
      "  const st = window.enggDrawing.state;",
      "  document.documentElement.setAttribute('__K__', JSON.stringify(st.activeTool || ''));"
    ]);
    if (tool !== "select") {
      await page.locator('#drawingToolList [data-tool-id="select"]').click();
      await page.waitForTimeout(300);
    }
  };

  // A line, then a dimension of it.
  await page.locator('#drawingToolList [data-tool-id="line"]').click();
  await page.waitForTimeout(300);
  await page.mouse.click(bb.x + 260, bb.y + 200);
  await page.waitForTimeout(300);
  await page.mouse.click(bb.x + 360, bb.y + 200);
  await page.waitForTimeout(700);

  await page.locator('button[data-category="ANNOTATE"]').click();
  await page.waitForTimeout(400);
  await page.locator('#drawingToolList [data-tool-id="dimension"]').click();
  await page.waitForTimeout(300);

  const lineBox = await inPage([
    "  const g = document.querySelector('svg .drawing-feature');",
    "  const r = g.getBoundingClientRect();",
    "  document.documentElement.setAttribute('__K__', JSON.stringify({",
    "    x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2)",
    "  }));"
  ]);

  await page.mouse.click(lineBox.x, lineBox.y);
  await page.waitForTimeout(500);
  await page.mouse.move(lineBox.x, lineBox.y - 90);
  await page.waitForTimeout(300);
  await page.mouse.click(lineBox.x, lineBox.y - 90);
  await page.waitForTimeout(800);

  // Calibration may have been requested; satisfy it so the dimension lands.
  if (await page.evaluate(() => !!document.querySelector(".drawing-scale-dialog"))) {
    await page.locator("#scaleRealDistance").fill("125");
    await page.locator("[data-scale-confirm]").click();
    await page.waitForTimeout(900);
  }

  // Where is the dimension's TEXT on screen?
  const dimText = await inPage([
    "  const st = window.enggDrawing.state;",
    "  const dim = st.objects.find(o => o.type === 'dimension');",
    "  const g = document.querySelector('svg .drawing-feature[data-feature-id=\"' + dim.id + '\"]');",
    "  const t = g ? g.querySelector('text') : null;",
    "  const r = t ? t.getBoundingClientRect() : null;",
    "  document.documentElement.setAttribute('__K__', JSON.stringify({",
    "    hasText: !!t,",
    "    text: t ? t.textContent : null,",
    "    x: r ? Math.round(r.x + r.width / 2) : null,",
    "    y: r ? Math.round(r.y + r.height / 2) : null",
    "  }));"
  ]);

  out.dimText = dimText;

  if (!dimText || !dimText.hasText) {
    out.result = "no dimension text found";
    return out;
  }

  // Click the TEXT: the DIMENSION must be selected, not the line under it.
  await selectTool();
  await page.mouse.click(dimText.x, dimText.y);
  await page.waitForTimeout(600);

  out.afterTextClick = await inPage([
    "  const st = window.enggDrawing.state;",
    "  const sel = st.selection.selectedObjectIds;",
    "  document.documentElement.setAttribute('__K__', JSON.stringify({",
    "    count: sel.length,",
    "    types: sel.map(id => (st.objects.find(o => o.id === id) || {}).type)",
    "  }));"
  ]);

  // Click the DIMENSION LINE, well away from the text and from the line.
  const lineHit = await inPage([
    "  const st = window.enggDrawing.state;",
    "  const dim = st.objects.find(o => o.type === 'dimension');",
    "  const g = window.enggDimensionModel.graphicsFor(dim, st);",
    "  document.documentElement.setAttribute('__K__', JSON.stringify({",
    "    line: g.line, textFrame: g.textFrame",
    "  }));"
  ]);

  out.dimLine = lineHit;

  // Click empty space first to clear, then the dimension line.
  await page.mouse.click(bb.x + 40, bb.y + 40);
  await page.waitForTimeout(400);

  // Convert the world line midpoint to screen using the canvas bounds.
  const screenPoint = await inPage([
    "  const st = window.enggDrawing.state;",
    "  const DS = window.enggDrawingState;",
    "  const dim = st.objects.find(o => o.type === 'dimension');",
    "  const g = window.enggDimensionModel.graphicsFor(dim, st);",
    "  const b = document.querySelector('.drawing-canvas').getBoundingClientRect();",
    "  const mid = { x: (g.line[0].x + g.line[1].x) / 2, y: (g.line[0].y + g.line[1].y) / 2 };",
    "  const p = DS.engineeringToScreen(mid, b, st);",
    "  document.documentElement.setAttribute('__K__', JSON.stringify({",
    "    x: Math.round(p.x), y: Math.round(p.y)",
    "  }));"
  ]);

  out.screenPoint = screenPoint;
  await page.mouse.click(screenPoint.x, screenPoint.y);
  await page.waitForTimeout(600);

  out.afterLineClick = await inPage([
    "  const st = window.enggDrawing.state;",
    "  const sel = st.selection.selectedObjectIds;",
    "  document.documentElement.setAttribute('__K__', JSON.stringify({",
    "    count: sel.length,",
    "    types: sel.map(id => (st.objects.find(o => o.id === id) || {}).type)",
    "  }));"
  ]);

  return out;
}

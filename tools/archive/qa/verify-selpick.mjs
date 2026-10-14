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

  const out = { errs };
  const bb = await page.locator(".drawing-canvas").first().boundingBox();

  let seq = 0;
  const inPage = (lines) => {
    seq += 1;
    const key = "data-t" + seq;
    return page
      .evaluate(
        (src) => {
          const s = document.createElement("script");
          s.textContent = src;
          document.body.appendChild(s);
          return null;
        },
        "(function(){\n" +
          lines.join("\n").split("__K__").join(key) +
          "\n})();",
      )
      .then(() => page.getAttribute("html", key))
      .then((v) => (v === null ? null : JSON.parse(v)));
  };

  const selected = () =>
    inPage([
      "  const st = window.enggDrawing.state;",
      "  const sel = st.selection.selectedObjectIds;",
      "  document.documentElement.setAttribute('__K__', JSON.stringify(sel.map(",
      "    id => (st.objects.find(o => o.id === id) || {}).type",
      "  )));",
    ]);

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
    "  }));",
  ]);

  await page.mouse.click(lineBox.x, lineBox.y);
  await page.waitForTimeout(500);
  await page.mouse.move(lineBox.x, lineBox.y - 90);
  await page.waitForTimeout(300);
  await page.mouse.click(lineBox.x, lineBox.y - 90);
  await page.waitForTimeout(800);

  if (
    await page.evaluate(() => !!document.querySelector(".drawing-scale-dialog"))
  ) {
    await page.locator("#scaleRealDistance").fill("125");
    await page.locator("[data-scale-confirm]").click();
    await page.waitForTimeout(900);
  }

  await page.locator('#drawingToolList [data-tool-id="select"]').click();
  await page.waitForTimeout(400);

  /*
   * Every clickable part of the dimension, measured from the RENDERED
   * SVG rather than recomputed from world geometry.
   *
   * Recomputing was tried first and gave points that were nowhere near
   * the drawing, which looked exactly like a broken hit test. Reading
   * the real rendered geometry is both simpler and correct.
   */
  const marks = await inPage([
    "  const st = window.enggDrawing.state;",
    "  const dim = st.objects.find(o => o.type === 'dimension');",
    "  const g = document.querySelector(",
    "    'svg .drawing-feature[data-feature-id=\"' + dim.id + '\"]'",
    "  );",
    "  const centre = (el) => {",
    "    const r = el.getBoundingClientRect();",
    "    return [Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)];",
    "  };",
    "  const lines = [...g.querySelectorAll('line')];",
    "  const t = g.querySelector('text');",
    "  const polys = [...g.querySelectorAll('polygon')];",
    "  document.documentElement.setAttribute('__K__', JSON.stringify({",
    "    text: t ? centre(t) : null,",
    "    arrowhead: polys.length ? centre(polys[0]) : null,",
    "    firstLine: lines.length ? centre(lines[0]) : null",
    "  }));",
  ]);

  out.marks = marks;

  const results = {};

  const tryClick = async (name, point) => {
    if (!point) {
      results[name] = "no mark";
      return;
    }
    await page.mouse.click(bb.x + 40, bb.y + 40); // clear
    await page.waitForTimeout(350);
    await page.mouse.click(point[0], point[1]);
    await page.waitForTimeout(500);
    results[name] = await selected();
  };

  await tryClick("text", marks.text);
  await tryClick("arrowhead", marks.arrowhead);
  await tryClick("firstLine", marks.firstLine);

  out.results = results;
  return out;
}

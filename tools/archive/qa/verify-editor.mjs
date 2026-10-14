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

  let seq = 0;
  const inPage = (lines) => {
    seq += 1;
    const key = "data-e" + seq;
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

  if (await page.evaluate(() => !!document.querySelector(".drawing-scale-dialog"))) {
    await page.locator("#scaleRealDistance").fill("125");
    await page.locator("[data-scale-confirm]").click();
    await page.waitForTimeout(900);
  }

  await page.locator('#drawingToolList [data-tool-id="select"]').click();
  await page.waitForTimeout(400);

  const dimText = await inPage([
    "  const st = window.enggDrawing.state;",
    "  const dim = st.objects.find(o => o.type === 'dimension');",
    "  const g = document.querySelector('svg .drawing-feature[data-feature-id=\"' + dim.id + '\"]');",
    "  const t = g.querySelector('text');",
    "  const r = t.getBoundingClientRect();",
    "  document.documentElement.setAttribute('__K__', JSON.stringify({",
    "    x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2)",
    "  }));"
  ]);

  // First click selects; second click opens the editor.
  await page.mouse.click(dimText.x, dimText.y);
  await page.waitForTimeout(500);
  out.afterFirstClick = await inPage([
    "  const st = window.enggDrawing.state;",
    "  document.documentElement.setAttribute('__K__', JSON.stringify(",
    "    st.selection.selectedObjectIds.map(id => (st.objects.find(o => o.id === id) || {}).type)));"
  ]);

  await page.mouse.click(dimText.x, dimText.y);
  await page.waitForTimeout(800);

  out.editorOpen = await page.evaluate(() => !!document.querySelector(".drawing-dimension-dialog"));
  out.editorFields = await page.evaluate(() => {
    const d = document.querySelector(".drawing-dimension-dialog");
    if (!d) return null;
    return {
      title: d.querySelector(".drawing-dimension-dialog-title")?.textContent,
      readout: d.querySelector(".drawing-dimension-dialog-value")?.textContent,
      meta: d.querySelector(".drawing-dimension-dialog-meta")?.textContent.replace(/\s+/g, " ").trim(),
      legends: [...d.querySelectorAll("legend")].map((l) => l.textContent.trim()),
      hasPrecision: !!d.querySelector("#dimPrecision"),
      /*
       * NO "show units" control. A visible dimension always states its unit,
       * so the dialog has no such option to offer - and this check exists to
       * confirm one has not crept back in.
       */
      hasShowUnits: !!d.querySelector("[data-dim-show-units]"),
      hasRealValue: !!d.querySelector("#dimRealValue"),
      note: d.querySelector(".drawing-dimension-dialog-note")?.textContent.replace(/\s+/g, " ").trim()
    };
  });

  return out;
}
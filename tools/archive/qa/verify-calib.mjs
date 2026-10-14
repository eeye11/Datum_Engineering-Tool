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
    const key = "data-c" + seq;
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

  // Draw a line.
  await page.locator('#drawingToolList [data-tool-id="line"]').click();
  await page.waitForTimeout(300);
  await page.mouse.click(bb.x + 260, bb.y + 200);
  await page.waitForTimeout(300);
  await page.mouse.click(bb.x + 360, bb.y + 200);
  await page.waitForTimeout(700);

  // First dimension: should open the calibration dialog.
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

  out.dialogOpen = await page.evaluate(() => !!document.querySelector(".drawing-scale-dialog"));
  out.dialogText = await page.evaluate(() => {
    const d = document.querySelector(".drawing-scale-dialog");
    if (!d) return null;
    return {
      title: d.querySelector(".drawing-scale-dialog-title")?.textContent,
      text: d.querySelector(".drawing-scale-dialog-text")?.textContent.replace(/\s+/g, " ").trim(),
      units: [...d.querySelectorAll("#scaleUnit option")].map((o) => o.value),
      hasConfirm: !!d.querySelector("[data-scale-confirm]"),
      hasCancel: !!d.querySelector("[data-scale-cancel]")
    };
  });

  out.beforeCalibrate = await inPage([
    "  const st = window.enggDrawing.state;",
    "  document.documentElement.setAttribute('__K__', JSON.stringify({",
    "    dims: st.objects.filter(o => o.type === 'dimension').length,",
    "    calibrated: window.enggDimensions.isCalibrated(st)",
    "  }));"
  ]);

  // Cancel first: nothing should be created.
  await page.locator("[data-scale-cancel]").click();
  await page.waitForTimeout(600);
  out.afterCancel = await inPage([
    "  const st = window.enggDrawing.state;",
    "  document.documentElement.setAttribute('__K__', JSON.stringify({",
    "    dims: st.objects.filter(o => o.type === 'dimension').length,",
    "    calibrated: window.enggDimensions.isCalibrated(st)",
    "  }));"
  ]);
  out.cancelMsg = await msg();

  // Try again, and this time set the scale.
  //
  // The tool is only re-picked if it is NOT already active: re-clicking
  // an active tool cancels it, so clicking it blindly would switch the
  // tool off and the next canvas click would fall through to selection.
  await page.evaluate(() => {
    const s = document.createElement("script");
    s.textContent = `
      (function(){
        const st = window.enggDrawing.state;
        document.documentElement.setAttribute('data-tool', st.activeTool || '');
      })();`;
    document.body.appendChild(s);
  });
  const activeNow = await page.getAttribute("html", "data-tool");
  if (activeNow !== "dimension") {
    await page.locator('#drawingToolList [data-tool-id="dimension"]').click();
    await page.waitForTimeout(300);
  }
  await page.mouse.click(lineBox.x, lineBox.y);
  await page.waitForTimeout(500);
  await page.mouse.move(lineBox.x, lineBox.y - 90);
  await page.waitForTimeout(300);
  await page.mouse.click(lineBox.x, lineBox.y - 90);
  await page.waitForTimeout(800);

  out.dialogAgain = await page.evaluate(
    () => !!document.querySelector(".drawing-scale-dialog")
  );

  await page.locator("#scaleRealDistance").fill("125");
  await page.locator("#scaleUnit").selectOption("mm");
  await page.locator("[data-scale-confirm]").click();
  await page.waitForTimeout(900);

  out.afterConfirm = await inPage([
    "  const st = window.enggDrawing.state;",
    "  const d = st.objects.find(o => o.type === 'dimension');",
    "  document.documentElement.setAttribute('__K__', JSON.stringify({",
    "    dims: st.objects.filter(o => o.type === 'dimension').length,",
    "    calibrated: window.enggDimensions.isCalibrated(st),",
    "    scale: window.enggDimensions.readScale(st),",
    "    text: d ? window.enggDimensionModel.formatMeasurement(d, st) : null",
    "  }));"
  ]);
  out.dialogGone = await page.evaluate(
    () => !document.querySelector(".drawing-scale-dialog")
  );

  // A SECOND dimension must not ask again.
  await page.evaluate(() => {
    const s = document.createElement("script");
    s.textContent = `
      (function(){
        const st = window.enggDrawing.state;
        document.documentElement.setAttribute('data-tool', st.activeTool || '');
      })();`;
    document.body.appendChild(s);
  });
  const toolAfterConfirm = await page.getAttribute("html", "data-tool");
  if (toolAfterConfirm !== "dimension") {
    await page.locator('#drawingToolList [data-tool-id="dimension"]').click();
    await page.waitForTimeout(300);
  }
  await page.mouse.click(lineBox.x, lineBox.y);
  await page.waitForTimeout(500);
  await page.mouse.move(lineBox.x, lineBox.y + 90);
  await page.waitForTimeout(300);
  await page.mouse.click(lineBox.x, lineBox.y + 90);
  await page.waitForTimeout(800);

  out.secondAsksAgain = await page.evaluate(
    () => !!document.querySelector(".drawing-scale-dialog")
  );
  out.afterSecond = await inPage([
    "  const st = window.enggDrawing.state;",
    "  document.documentElement.setAttribute('__K__', JSON.stringify({",
    "    dims: st.objects.filter(o => o.type === 'dimension').length",
    "  }));"
  ]);

  return out;
}

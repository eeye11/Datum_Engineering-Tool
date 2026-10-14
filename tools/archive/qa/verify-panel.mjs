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
    const key = "data-f" + seq;
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

  // Two features, so the panel has rows to pick between.
  await page.locator('#drawingToolList [data-tool-id="line"]').click();
  await page.waitForTimeout(300);
  await page.mouse.click(bb.x + 220, bb.y + 180);
  await page.waitForTimeout(300);
  await page.mouse.click(bb.x + 360, bb.y + 180);
  await page.waitForTimeout(600);

  await page.locator('#drawingToolList [data-tool-id="circle"]').click();
  await page.waitForTimeout(300);
  await page.mouse.click(bb.x + 280, bb.y + 300);
  await page.waitForTimeout(300);
  await page.mouse.click(bb.x + 340, bb.y + 360);
  await page.waitForTimeout(700);

  // Switch to the Features view.
  const back = page.locator("#drawingFeaturesBack");
  if (await back.count()) {
    await back.click();
    await page.waitForTimeout(600);
  }

  const readSel = () =>
    inPage([
      "  const st = window.enggDrawing.state;",
      "  document.documentElement.setAttribute('__K__', JSON.stringify(",
      "    st.selection.selectedObjectIds));",
    ]);

  out.rows = await page.evaluate(
    () => document.querySelectorAll(".drawing-component-row").length,
  );

  // Click the FIRST row: selects it.
  const first = page.locator(".drawing-component-row").first();
  await first.click();
  await page.waitForTimeout(500);
  out.afterRowClick = await readSel();

  // Click EMPTY space in the panel: must deselect.
  const panel = page.locator("#drawingProperties");
  const box = await panel.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height - 20);
  await page.waitForTimeout(600);
  out.afterEmptyClick = await readSel();

  // Click the SECOND row: selects it, deselecting the first.
  const rows = page.locator(".drawing-component-row");
  if ((await rows.count()) > 1) {
    await rows.nth(1).click();
    await page.waitForTimeout(500);
    out.afterSecondRow = await readSel();
  }

  // Canvas and panel must agree.
  out.highlighted = await page.evaluate(
    () => document.querySelectorAll(".drawing-component-row.selected").length,
  );

  return out;
}

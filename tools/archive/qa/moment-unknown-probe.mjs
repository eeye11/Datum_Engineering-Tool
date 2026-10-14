/*
 * Probe: after confirming an EMPTY moment value, what is actually on the
 * feature?
 */
export default async function run(page) {
  const errs = [];
  page.on("pageerror", (e) =>
    errs.push("PAGEERROR: " + e.message.slice(0, 220)),
  );
  page.on("console", (m) => {
    if (m.type() === "error") errs.push("CONSOLE: " + m.text().slice(0, 180));
  });

  await page.evaluate(async () => {
    await import("/src/main.js");
  });
  await page.waitForFunction(
    () => !!(window.enggDrawing && window.enggDrawing.state),
    { timeout: 15000 },
  );

  const tab = page
    .locator("button", { hasText: "Engineering Drawing" })
    .first();
  if (await tab.count()) await tab.click();
  await page.waitForTimeout(900);

  await page.evaluate(() => {
    const st = window.enggDrawing.state;
    st.objects.length = 0;
    st.selection.selectedObjectIds = [];
  });

  await page.locator('button[data-category="STATICS"]').click();
  await page.waitForTimeout(250);
  await page
    .locator('#drawingToolList [data-tool-id="moment"]')
    .first()
    .click();
  await page.waitForTimeout(250);

  const box = await page.locator(".drawing-canvas").first().boundingBox();

  await page.mouse.click(box.x + 300, box.y + 220);
  await page.waitForTimeout(500);

  const opened = await page.evaluate(() =>
    Boolean(document.querySelector(".drawing-creation-dimension")),
  );

  await page.locator("[data-load-input]").first().fill("");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(500);

  return page.evaluate((opened) => {
    const st = window.enggDrawing.state;
    const moments = st.objects.filter((o) => o.type === "moment");
    const m = moments[moments.length - 1];

    return {
      opened,
      momentCount: moments.length,
      keys: m ? Object.keys(m) : [],
      unknownValues: m ? m.unknownValues : null,
      geometry: m ? m.geometry : null,
      magnitudeLabel: m ? m.magnitudeLabel : null,
    };
  }, opened);
}

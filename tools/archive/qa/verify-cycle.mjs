export default async function run(page, ui) {
  await page.goto("http://localhost:8099/", { waitUntil: "load" });
  await page.waitForTimeout(2000);
  const tab = page
    .locator("button", { hasText: "Engineering Drawing" })
    .first();
  if (await tab.count()) await tab.click();
  await page.waitForTimeout(1500);

  const b = await page.locator(".drawing-workspace").first().boundingBox();
  const cx = b.x + b.width / 2,
    cy = b.y + b.height / 2;
  const msg = () =>
    page.evaluate(
      () => document.getElementById("drawingToolMessage")?.textContent,
    );

  // A Rectangle offers more than one measurement, so D has something to cycle.
  await page.locator('button[data-category="GEOMETRY"]').click();
  await page.waitForTimeout(400);
  await page.locator('#drawingToolList [data-tool-id="rectangle"]').click();
  await page.waitForTimeout(250);
  await page.mouse.click(cx - 160, cy - 160);
  await page.waitForTimeout(200);
  await page.mouse.click(cx + 40, cy - 20);
  await page.waitForTimeout(600);

  await page.locator('button[data-category="ANNOTATE"]').click();
  await page.waitForTimeout(400);
  await page.locator('#drawingToolList [data-tool-id="dimension"]').click();
  await page.waitForTimeout(250);
  await page.mouse.click(cx - 60, cy - 90);
  await page.waitForTimeout(500);

  const out = { armed: await msg() };
  out.previewText = await page.evaluate(() =>
    [...document.querySelectorAll(".drawing-dimension-preview text")].map((t) =>
      t.textContent.trim(),
    ),
  );

  await page.keyboard.press("d");
  await page.waitForTimeout(500);
  out.afterD1 = await msg();
  out.previewTextD1 = await page.evaluate(() =>
    [...document.querySelectorAll(".drawing-dimension-preview text")].map((t) =>
      t.textContent.trim(),
    ),
  );

  await page.keyboard.press("d");
  await page.waitForTimeout(500);
  out.afterD2 = await msg();
  out.previewTextD2 = await page.evaluate(() =>
    [...document.querySelectorAll(".drawing-dimension-preview text")].map((t) =>
      t.textContent.trim(),
    ),
  );

  return out;
}

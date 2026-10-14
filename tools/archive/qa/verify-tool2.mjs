export default async function run(page, ui) {
  const errs = [];
  page.on("pageerror", (e) =>
    errs.push("PAGEERROR: " + e.message.slice(0, 300)),
  );
  page.on("console", (m) => {
    if (m.type() === "error") errs.push("CONSOLE: " + m.text().slice(0, 300));
  });

  await page.goto("http://localhost:8099/", { waitUntil: "load" });
  await page.waitForTimeout(2000);
  const tab = page
    .locator("button", { hasText: "Engineering Drawing" })
    .first();
  if (await tab.count()) await tab.click();
  await page.waitForTimeout(1500);

  const msg = () =>
    page.evaluate(
      () => document.getElementById("drawingToolMessage")?.textContent || "",
    );
  const out = { errs };

  await page.locator('button[data-category="ANNOTATE"]').click();
  await page.waitForTimeout(400);
  await page.locator('#drawingToolList [data-tool-id="dimension"]').click();
  await page.waitForTimeout(300);
  out.onActivate = await msg();

  // Draw a line first using the Line tool.
  await page.locator('button[data-category="GEOMETRY"]').click();
  await page.waitForTimeout(400);
  const b = await page.locator(".drawing-workspace").first().boundingBox();
  const cx = b.x + b.width / 2,
    cy = b.y + b.height / 2;

  await page.locator('#drawingToolList [data-tool-id="line"]').click();
  await page.waitForTimeout(250);
  await page.mouse.click(cx - 150, cy);
  await page.waitForTimeout(200);
  await page.mouse.click(cx + 150, cy);
  await page.waitForTimeout(600);
  out.afterLine = await msg();
  out.lineCount = await page.evaluate(
    () => document.querySelectorAll("svg .drawing-feature").length,
  );

  // Back to Dimension.
  await page.locator('button[data-category="ANNOTATE"]').click();
  await page.waitForTimeout(400);
  await page.locator('#drawingToolList [data-tool-id="dimension"]').click();
  await page.waitForTimeout(300);
  out.reactivated = await msg();

  await page.mouse.click(cx, cy);
  await page.waitForTimeout(400);
  out.afterArmClick = await msg();

  await page.mouse.click(cx, cy + 90);
  await page.waitForTimeout(700);
  out.afterPlaceClick = await msg();

  out.svg = await page.evaluate(() => ({
    features: document.querySelectorAll("svg .drawing-feature").length,
    texts: [...document.querySelectorAll("svg text")]
      .map((t) => t.textContent.trim())
      .filter(Boolean),
    dashed: document.querySelectorAll('svg [stroke-dasharray="4 3"]').length,
    polys: document.querySelectorAll("svg polygon").length,
  }));

  return out;
}

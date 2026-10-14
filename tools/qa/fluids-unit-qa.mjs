export default async function run(page, ui) {
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: "Engineering Drawing" }).click();
  await page.waitForTimeout(600);

  const switchFluids = async () => {
    await page.evaluate(() => {
      [...document.querySelectorAll(".drawing-category")]
        .find((el) => el.dataset.category === "FLUIDS")
        ?.click();
    });
    await page.waitForTimeout(250);
  };

  await switchFluids();
  await page.evaluate(() => {
    document.querySelector('.drawing-tool[data-tool-id="pipe-duct"]')?.click();
  });
  await page.waitForTimeout(250);

  const svgBox = await page.evaluate(() => {
    const svg = document.querySelector(".drawing-canvas svg");
    const b = svg.getBoundingClientRect();
    return { x: b.x, y: b.y, width: b.width, height: b.height };
  });
  const cx = svgBox.x + svgBox.width / 2;
  const cy = svgBox.y + svgBox.height / 2;

  for (const [x, y] of [
    [cx - 200, cy - 100],
    [cx - 40, cy - 100],
    [cx - 40, cy + 100],
  ]) {
    await page.mouse.click(x, y);
    await page.waitForTimeout(180);
  }
  await page.keyboard.press("Enter");
  await page.waitForTimeout(600);

  await page.evaluate(() => {
    document.querySelectorAll(".drawing-component-twisty").forEach((t) => {
      if (!t.classList.contains("expanded")) t.click();
    });
  });
  await page.waitForTimeout(250);

  // Open the route edit page.
  await page.evaluate(() => {
    const rows = [...document.querySelectorAll(".drawing-component-row")];
    const i = rows.findIndex((r) => /Route/i.test(r.textContent));
    rows[i]?.click();
  });
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    const rows = [...document.querySelectorAll(".drawing-component-row")];
    const i = rows.findIndex((r) => /Route/i.test(r.textContent));
    rows[i]?.click();
  });
  await page.waitForTimeout(400);

  const routeDetail = await page.evaluate(() => {
    const host = document.getElementById("drawingProperties");
    const unitSelects = [
      ...host.querySelectorAll("[data-property='lengthUnit']"),
    ].map((s) => ({
      property: s.dataset.property,
      value: s.value,
      options: [...s.options].map((o) => o.value),
    }));
    const diameter = [...host.querySelectorAll(".drawing-property-grid")].find(
      (r) =>
        r.querySelector(".drawing-property-grid-label")?.textContent?.trim() ===
        "Diameter",
    );
    return {
      unitSelectCount: unitSelects.length,
      unitSelects: unitSelects.slice(0, 5),
      diameterHtml:
        diameter?.outerHTML?.replace(/\s+/g, " ").slice(0, 600) || null,
    };
  });

  return { routeDetail };
}

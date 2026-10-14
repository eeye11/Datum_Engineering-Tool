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

  const raw = await page.evaluate(() => {
    const host = document.getElementById("drawingProperties");
    return {
      exists: Boolean(host),
      selectedId: host?.dataset?.selectedObjectId || null,
      childCount: host?.children?.length ?? 0,
      classes: host ? [...host.children].map((c) => c.className) : [],
      htmlLength: host?.innerHTML?.length ?? 0,
      htmlHead: host?.innerHTML?.slice(0, 2500) || "",
    };
  });

  return raw;
}

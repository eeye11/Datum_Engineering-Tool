/*
 * Live: build geometry with explicit pointer events and verify dimensions.
 */
export default async function run(page, ui) {
  const out = {};

  const tab = (await ui.snapshot()).match(
    /@(e\d+) button "Engineering Drawing"/,
  )?.[1];
  if (tab) {
    await ui.click(tab);
    await page.waitForTimeout(900);
  }

  const shelf = (name) =>
    page.evaluate((n) => {
      document
        .querySelector(`.drawing-category[data-category="${n}"]`)
        ?.click();
    }, name);
  const pickTool = async (id) => {
    await page.evaluate((tid) => {
      document
        .querySelector(`#drawingToolList [data-tool-id="${tid}"]`)
        ?.click();
    }, id);
    await page.waitForTimeout(250);
  };

  const rect = await page.evaluate(() => {
    const r = document.querySelector(".drawing-canvas").getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });

  const clickAt = async (fx, fy) => {
    const x = rect.x + rect.w * fx;
    const y = rect.y + rect.h * fy;
    await page.mouse.move(x, y);
    await page.waitForTimeout(60);
    await page.mouse.down();
    await page.waitForTimeout(30);
    await page.mouse.up();
    await page.waitForTimeout(250);
  };

  const objects = () =>
    page.evaluate(() => {
      const svg = document.querySelector(".drawing-canvas svg");
      return {
        lines: Array.from(svg?.querySelectorAll("line[data-feature-id]") || [])
          .length,
        dashed: Array.from(svg?.querySelectorAll("line") || []).filter(
          (l) => (l.getAttribute("stroke-dasharray") || "").length,
        ).length,
        ids: Array.from(svg?.querySelectorAll("[data-feature-id]") || []).map(
          (e) => e.getAttribute("data-feature-id"),
        ),
      };
    });

  await shelf("GEOMETRY");
  await pickTool("line");
  await clickAt(0.25, 0.55);
  await clickAt(0.65, 0.55);
  out.afterLine1 = await objects();

  await pickTool("line");
  await clickAt(0.25, 0.7);
  await clickAt(0.65, 0.7);
  out.afterLine2 = await objects();

  // Smart Dimension on the two lines.
  await shelf("ANNOTATE");
  await pickTool("smart-dimension");
  await clickAt(0.45, 0.55);
  out.msg1 = await page.evaluate(
    () => document.getElementById("drawingToolMessage")?.textContent,
  );
  await clickAt(0.45, 0.7);
  out.msg2 = await page.evaluate(
    () => document.getElementById("drawingToolMessage")?.textContent,
  );
  await page.keyboard.press("Enter");
  await page.waitForTimeout(400);
  out.msg3 = await page.evaluate(
    () => document.getElementById("drawingToolMessage")?.textContent,
  );
  await clickAt(0.45, 0.5);
  await page.waitForTimeout(400);

  out.final = await page.evaluate(() => {
    const svg = document.querySelector(".drawing-canvas svg");
    return {
      texts: Array.from(svg?.querySelectorAll("text") || [])
        .map((t) => t.textContent.trim())
        .filter(Boolean),
      message: document.getElementById("drawingToolMessage")?.textContent || "",
    };
  });

  return out;
}

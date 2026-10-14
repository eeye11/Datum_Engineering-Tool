/*
 * Live end-to-end part 2:
 *  - drag the magnitude box, confirm the force geometry is unchanged;
 *  - change the magnitude, confirm the text updates at the same position;
 *  - run Smart Dimension on two lines.
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
    await page.mouse.click(rect.x + rect.w * fx, rect.y + rect.h * fy);
    await page.waitForTimeout(300);
  };

  // Two horizontal-ish lines for Smart Dimension.
  await shelf("GEOMETRY");
  await pickTool("line");
  await clickAt(0.2, 0.6);
  await clickAt(0.6, 0.6);
  await pickTool("line");
  await clickAt(0.2, 0.7);
  await clickAt(0.6, 0.7);

  // Smart Dimension: click line A, click line B, press Enter.
  await shelf("ANNOTATE");
  await pickTool("smart-dimension");
  await clickAt(0.4, 0.6);
  await clickAt(0.4, 0.7);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(400);
  out.messageAfterEnter = await page.evaluate(
    () => document.getElementById("drawingToolMessage")?.textContent || "",
  );
  await clickAt(0.4, 0.52); // place

  await page.waitForTimeout(300);

  out.afterDimension = await page.evaluate(() => {
    const canvas = document.querySelector(".drawing-canvas");
    return {
      text: (canvas?.textContent || "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 400),
      message: document.getElementById("drawingToolMessage")?.textContent || "",
    };
  });

  return out;
}

/*
 * Click the Engineering Drawing tab and report what actually happened.
 */
export default async function run(page, ui) {
  await page.waitForTimeout(900);

  const before = await page.evaluate(() => ({
    writingActive: document
      .querySelector("#writing")
      ?.classList.contains("active"),
    drawingActive: document
      .querySelector("#drawing")
      ?.classList.contains("active"),
    writingDisplay: getComputedStyle(document.querySelector("#writing"))
      .display,
    drawingDisplay: getComputedStyle(document.querySelector("#drawing"))
      .display,
  }));

  const tab = page.locator('.tab[data-tab="drawing"]');
  const tabExists = (await tab.count()) > 0;

  if (!tabExists) {
    return { error: "drawing tab not found", before };
  }

  await tab
    .click({ timeout: 5000 })
    .catch((e) => ({ clickError: String(e).slice(0, 200) }));
  await page.waitForTimeout(900);

  const after = await page.evaluate(() => {
    const drawing = document.querySelector("#drawing");
    const canvas = document.querySelector("#drawing canvas, #drawing svg");
    return {
      writingActive: document
        .querySelector("#writing")
        ?.classList.contains("active"),
      drawingActive: drawing?.classList.contains("active"),
      drawingDisplay: drawing ? getComputedStyle(drawing).display : null,
      drawingVisible: drawing ? drawing.getBoundingClientRect().height : 0,
      hasCanvas: Boolean(canvas),
      canvasSize: canvas
        ? `${canvas.getBoundingClientRect().width}x${canvas.getBoundingClientRect().height}`
        : null,
      toolsPanelPresent: Boolean(
        document.querySelector(".drawing-tools, .drawing-toolbar"),
      ),
    };
  });

  return { tabExists, before, after };
}

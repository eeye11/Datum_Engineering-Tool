/*
 * Verifies the two top-level tabs: same (smaller) size, and both switch.
 */
export default async function run(page) {
  await page.waitForFunction(() => typeof window.datum === "object", null, {
    timeout: 60000,
  });

  await page.waitForTimeout(500);

  const before = await page.evaluate(() => {
    const tabs = [...document.querySelectorAll(".tab")].map((tab) => {
      const s = getComputedStyle(tab);
      return {
        tab: tab.dataset.tab,
        label: tab.textContent.trim(),
        fontSize: s.fontSize,
        fontWeight: s.fontWeight,
      };
    });

    return { tabs };
  });

  /* Click the Engineering Drawing tab and confirm it activates. */
  const afterClick = await page.evaluate(async () => {
    const drawingTab = document.querySelector('.tab[data-tab="drawing"]');
    drawingTab.click();
    await new Promise((r) => setTimeout(r, 700));

    return {
      drawingActive: document
        .querySelector('.tab[data-tab="drawing"]')
        .classList.contains("active"),
      drawingSectionVisible: Boolean(document.querySelector("#drawing.active")),
      canvasPresent: Boolean(document.querySelector(".drawing-canvas")),
    };
  });

  /* And back to Written Solution. */
  const backToWriting = await page.evaluate(async () => {
    const writingTab = document.querySelector('.tab[data-tab="writing"]');
    writingTab.click();
    await new Promise((r) => setTimeout(r, 500));

    return {
      writingActive: document
        .querySelector('.tab[data-tab="writing"]')
        .classList.contains("active"),
      writingSectionVisible: Boolean(document.querySelector("#writing.active")),
    };
  });

  return { before, afterClick, backToWriting };
}

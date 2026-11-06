export default async function run(page) {
  const wait = (ms) => page.waitForTimeout(ms);
  const out = {};

  await page.evaluate(() =>
    document.querySelector('.tab[data-tab="drawing"]')?.click(),
  );
  await wait(1500);

  out.diagnosis = await page.evaluate(() => {
    const button = document.getElementById("drawingSpecialSymbols");
    const pickerModule = window.__daetumSymbols || null;

    return {
      buttonFound: Boolean(button),
      insideBar: button
        ? Boolean(
            button.closest(
              ".drawing-style-strip, .drawing-menu-controls-bar, .drawing-toolbar",
            ),
          )
        : null,
      barCount: document.querySelectorAll(".drawing-status-toggle").length,
      panelBefore: document.querySelectorAll(".datum-symbol-picker").length,
      hasPickerCss: [...document.styleSheets].length,
    };
  });

  /* Synchronous listeners fire first; a capture logger sees every click. */
  await page.evaluate(() => {
    window.__clicks = 0;
    document.addEventListener(
      "click",
      (event) => {
        if (event.target.closest?.("#drawingSpecialSymbols"))
          window.__clicks += 1;
      },
      true,
    );
  });

  await page.click("#drawingSpecialSymbols");
  await wait(800);

  out.afterClick = await page.evaluate(() => ({
    captureClicks: window.__clicks,
    picker: document.querySelectorAll(".datum-symbol-picker").length,
    pickerHtmlHead:
      document.querySelector(".datum-symbol-picker")?.outerHTML.slice(0, 120) ||
      null,
    activeTool: window.datum?.drawingState?.activeTool ?? null,
  }));

  return out;
}

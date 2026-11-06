export default async function run(page) {
  const wait = (ms) => page.waitForTimeout(ms);
  const out = {};

  await page.evaluate(() =>
    document.querySelector('.tab[data-tab="drawing"]')?.click(),
  );
  await wait(1500);

  /* What is painted at the button's own centre? */
  out.atPoint = await page.evaluate(() => {
    const button = document.getElementById("drawingSpecialSymbols");
    const rect = button.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const top = document.elementFromPoint(x, y);

    return {
      rect: { left: rect.left, top: rect.top, w: rect.width, h: rect.height },
      topElement: top
        ? `${top.tagName}#${top.id}.${String(top.className).slice(0, 40)}`
        : null,
      isButton:
        top === button || Boolean(top?.closest?.("#drawingSpecialSymbols")),
      viewport: { w: window.innerWidth, h: window.innerHeight },
    };
  });

  /* Dispatch the click straight on the element - skips any overlay. */
  out.directClick = await page.evaluate(() => {
    const button = document.getElementById("drawingSpecialSymbols");
    button.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );

    return document.querySelectorAll(".datum-symbol-picker").length;
  });

  await wait(500);
  out.pickerAfterDirect = await page.locator(".datum-symbol-picker").count();

  return out;
}

export default async function run(page) {
  const wait = (ms) => page.waitForTimeout(ms);
  const out = {};

  await page.evaluate(() =>
    document.querySelector('.tab[data-tab="drawing"]')?.click(),
  );
  await wait(1200);

  /* The button exists and is wired. */
  out.button = await page.evaluate(() => {
    const button = document.getElementById("drawingSpecialSymbols");
    return button
      ? { found: true, label: button.getAttribute("aria-label") }
      : { found: false };
  });

  /* Press it with nothing being edited. */
  await page.click("#drawingSpecialSymbols");
  await wait(600);

  out.openedWithoutField = await page.locator(".datum-symbol-picker").count();
  out.pickerItems = await page.locator("[data-symbol-id]").count();
  out.pickerFirstHeading = await page
    .locator(".datum-symbol-picker-heading")
    .first()
    .textContent()
    .catch(() => null);

  await page.screenshot({ path: "qa-symbols.png" });

  return out;
}

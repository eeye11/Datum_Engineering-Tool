/*
 * Screenshot the top of the Engineering Drawing workspace in a given theme,
 * optionally with the top bar hidden. Read-only.
 *
 *   $env:DATUM_THEME="dark"; $env:DATUM_HIDE="1"; node <skill>/browser.mjs <url> --script ...
 */
export default async function run(page) {
  const theme = process.env.DATUM_THEME || "light";
  const hidden = process.env.DATUM_HIDE === "1";

  await page.evaluate((t) => {
    document.documentElement.setAttribute("data-theme", t);
  }, theme);

  await page.getByRole("button", { name: "Engineering Drawing" }).click();
  await page.waitForTimeout(400);

  if (hidden) {
    await page.locator("#headerHideButton").click();
    await page.waitForTimeout(300);
  }

  return { ok: true, theme, hidden };
}

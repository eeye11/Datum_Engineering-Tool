/*
 * Does opening the Engineering Drawing workspace make the automation handles
 * appear?
 *
 * The app renders fully and `renderEngineeringTools` has run (nine tool buttons
 * exist), yet the handles are absent. One explanation remains: the handles ARE
 * installed, but the probe runs before the drawing workspace is opened, and the
 * module that installs them is only evaluated when the drawing tab loads.
 */
export default async function run(page) {
  const probe = async (label) => ({
    label,
    hooks: await page.evaluate(() => typeof window.enggDrawingStateLive),
    datum: await page.evaluate(() => typeof window.datum),
    keyCount: await page.evaluate(
      () =>
        Object.getOwnPropertyNames(window).filter((k) => /^engg|^datum/.test(k))
          .length,
    ),
    toolButtons: await page.evaluate(
      () => document.querySelectorAll("#drawing .drawing-tool").length,
    ),
    bodyChars: await page.evaluate(() => document.body.innerText.length),
  });

  const out = [await probe("on load (Written Solution tab)")];

  await page.evaluate(() => {
    const tab = document.querySelector('.tab[data-tab="drawing"]');
    if (tab) tab.click();
  });
  await page.waitForTimeout(1500);

  out.push(await probe("after opening the drawing workspace"));

  return out;
}

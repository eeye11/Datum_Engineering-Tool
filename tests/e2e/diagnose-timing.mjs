/*
 * Does `window.datum` appear at all on a clean load, and if so when?
 *
 * The re-import probe set it successfully, which means the module BODY is fine.
 * This watches the live page instead: it polls for `datum` from the very first
 * moment and records the load-timeline, so a late arrival is distinguished from
 * one that never happens.
 */
export default async function run(page) {
  const timeline = [];

  const probe = async (label) =>
    timeline.push({
      label,
      datum: await page.evaluate(() => typeof window.datum),
      hooks: await page.evaluate(() => typeof window.enggDrawingStateLive),
      menuItems: await page.evaluate(
        () => document.getElementById("datumMenuBar")?.children.length ?? -1,
      ),
    });

  await probe("immediately");

  await page.waitForTimeout(1500);
  await probe("after 1.5s");

  // Force the entry module to be re-fetched and re-evaluated.
  await page.evaluate(async () => {
    await import(`/src/app/entry/main.js?again=${Date.now()}`);
  });
  await page.waitForTimeout(300);
  await probe("after explicit re-import");

  return { timeline };
}

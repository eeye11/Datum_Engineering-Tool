/*
 * Does the page's OWN main.js module body actually run?
 *
 * Everything imported from the page works when re-imported by hand, and nothing
 * throws. So the question is no longer "what breaks" but "does the entry module
 * body execute at all during a normal load". This leaves a marker inside a
 * module the entry imports and checks whether the marker appears.
 */
export default async function run(page, ui) {
  const out = {};

  // A fresh navigation, with a hook placed BEFORE any module can run.
  await page.addInitScript(() => {
    window.__bootProbe = { steps: [] };
    window.addEventListener("DOMContentLoaded", () =>
      window.__bootProbe.steps.push("domcontentloaded"),
    );
    window.addEventListener("load", () =>
      window.__bootProbe.steps.push("load"),
    );
  });

  await page.goto("http://localhost:5173/", { waitUntil: "load" });
  await page.waitForTimeout(2500);

  out.probe = await page.evaluate(() => window.__bootProbe);

  // Which script modules did the browser actually request?
  out.requested = await page.evaluate(() =>
    performance
      .getEntriesByType("resource")
      .map((e) => e.name)
      .filter((n) => n.includes("/src/"))
      .map((n) => n.replace(location.origin, ""))
      .slice(0, 60),
  );

  out.state = await page.evaluate(() => ({
    datum: typeof window.datum,
    hooks: typeof window.enggDrawingStateLive,
    menuItems: document.getElementById("datumMenuBar")?.children.length ?? -1,
    drawingSection: !!document.getElementById("drawing"),
  }));

  return out;
}

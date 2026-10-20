export default async function run(page) {
  const seen = [];
  page.on("pageerror", (e) => seen.push("pageerror: " + e.message));
  page.on("requestfailed", (r) =>
    seen.push("reqfail: " + r.url() + " " + r.failure()?.errorText),
  );

  await page.goto("http://localhost:5201/", { waitUntil: "load" });
  await page.waitForTimeout(2500);

  const s1 = await page.evaluate(() => ({
    datum: typeof window.datum,
    hooks: typeof window.enggDrawingStateLive,
    tabs: [...document.querySelectorAll(".tab")].map((t) =>
      t.getAttribute("data-tab"),
    ),
  }));

  await page.evaluate(() => {
    document.querySelector('.tab[data-tab="drawing"]')?.click();
  });
  await page.waitForTimeout(2000);

  const s2 = await page.evaluate(() => ({
    datum: typeof window.datum,
    hooks: typeof window.enggDrawingStateLive,
    tool: window.enggDrawingStateLive?.activeTool ?? null,
    main: window.__enggMainRan || null,
  }));

  return { s1, s2, seen };
}

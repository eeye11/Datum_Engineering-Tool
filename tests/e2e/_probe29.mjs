gexport default async function run(page) {
  await page.goto("http://localhost:5211/", { waitUntil: "load" });
  await page.waitForTimeout(3000);

  return await page.evaluate(() => ({
    datum: typeof window.datum,
    hooks: typeof window.enggDrawingStateLive,
    main: window.__enggMainRan || null,
    scripts: [...document.scripts].map((s) => s.src).slice(0, 4),
  }));
}

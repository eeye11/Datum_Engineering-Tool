// Boot the app with the CDN MathJax request aborted, so the headless run does
// not hang on an unreachable external script. The app's own modules then run.
export default async function run(page) {
  await page.route("**/cdn.jsdelivr.net/**", (route) => route.abort());

  const errors = [];
  page.on("pageerror", (e) =>
    errors.push(String(e && e.message ? e.message : e)),
  );

  await page.goto("http://localhost:5173/", { waitUntil: "load" });
  await page.waitForTimeout(5000);

  const info = await page.evaluate(() => ({
    bodyChars: document.body.innerText.length,
    hasDatum: typeof window.datum,
    hasHooks: typeof window.enggDrawingState,
  }));

  return { info, errors: errors.slice(0, 10) };
}

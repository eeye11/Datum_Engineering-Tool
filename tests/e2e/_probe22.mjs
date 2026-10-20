export default async function run(page) {
  const logs = [];

  page.on("console", (m) => logs.push(`console.${m.type()}: ${m.text()}`));
  page.on("pageerror", (e) => logs.push(`pageerror: ${e.message}`));
  page.on("requestfailed", (r) =>
    logs.push(`reqfail: ${r.url()} ${r.failure()?.errorText}`),
  );
  page.on("response", (r) => {
    if (r.status() >= 400) logs.push(`http ${r.status()}: ${r.url()}`);
  });

  await page.reload({ waitUntil: "load" });
  await page.waitForTimeout(3000);

  const modules = await page.evaluate(async () => {
    window.__importResult = null;

    try {
      await import("/src/app/entry/main.js?probe=1");
      window.__importResult = "ok";
    } catch (error) {
      window.__importResult = `${error.name}: ${error.message}\n${error.stack}`;
    }

    return window.__importResult;
  });

  return {
    modules,
    mainRan: await page.evaluate(() => window.__enggMainRan || null),
    logs,
  };
}

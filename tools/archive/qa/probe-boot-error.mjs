export default async function run(page) {
  const errors = [];

  page.on("pageerror", (e) =>
    errors.push("pageerror: " + String((e && e.message) || e)),
  );
  page.on("console", (m) => {
    if (m.type() === "error") errors.push("console: " + m.text());
  });

  await page.waitForTimeout(1500);

  let importError = null;

  try {
    await page.evaluate(async () => {
      await import("/src/main.js");
    });
  } catch (e) {
    importError = String((e && e.stack) || e);
  }

  await page.waitForTimeout(1500);

  return {
    errors,
    importError,
    datum: await page.evaluate(() => typeof window.datum),
    drawing: await page.evaluate(() => typeof window.enggDrawing),
  };
}

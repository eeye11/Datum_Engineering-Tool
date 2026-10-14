export default async function run(page) {
  await page.waitForFunction(() => typeof window.datum === "object", null, {
    timeout: 20000,
  });

  const result = await page.evaluate(async () => {
    const keys = Object.keys(window).filter((k) => k.startsWith("engg"));
    let manual = null;
    let error = null;
    try {
      const mod = await import("/src/app/automation-hooks.js");
      mod.installAutomationHooks();
      manual = Object.keys(window).filter((k) => k.startsWith("engg"));
    } catch (e) {
      error = String((e && e.message) || e);
    }
    return { keys, manual, error };
  });

  return result;
}

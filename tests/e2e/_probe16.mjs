export default async function run(page) {
  const logs = [];
  page.on("console", (m) => logs.push(`${m.type()}: ${m.text()}`));
  page.on("pageerror", (e) => logs.push(`pageerror: ${e.message}`));

  await page.getByText("Engineering Drawing", { exact: true }).first().click();
  await page.waitForTimeout(1200);

  const state = await page.evaluate(() => ({
    live: typeof window.enggDrawingStateLive,
    tool: window.enggDrawingStateLive?.activeTool ?? null,
    keys: Object.keys(window)
      .filter((k) => /engg|datum/i.test(k))
      .slice(0, 8),
  }));

  return { state, logs: logs.slice(0, 10) };
}

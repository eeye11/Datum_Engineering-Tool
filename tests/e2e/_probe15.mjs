export default async function run(page) {
  const logs = [];
  page.on("console", (m) => logs.push(`${m.type()}: ${m.text()}`));
  page.on("pageerror", (e) => logs.push(`pageerror: ${e.message}\n${e.stack}`));

  await page.reload();
  await page.waitForTimeout(2500);

  const state = await page.evaluate(() => ({
    keys: Object.keys(window)
      .filter((k) => /engg|datum|__/.test(k))
      .slice(0, 20),
    tools: document.querySelectorAll("[data-tool-id]").length,
    canvas: !!document.querySelector(".drawing-canvas"),
  }));

  return { state, logs };
}

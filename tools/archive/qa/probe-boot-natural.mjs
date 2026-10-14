export default async function run(page) {
  const errors = [];

  page.on("pageerror", (e) => errors.push(String((e && e.message) || e)));

  await page.waitForTimeout(3000);

  const first = await page.evaluate(() => ({
    datum: typeof window.datum,
    drawing: typeof window.enggDrawing,
    canvas: Boolean(document.querySelector(".drawing-canvas")),
    scripts: [...document.scripts].map((s) => s.src || "inline"),
  }));

  return { errors, first };
}

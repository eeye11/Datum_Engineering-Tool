export default async function run(page) {
  const out = { errors: [] };

  page.on("pageerror", (e) => {
    out.errors.push(String((e && e.message) || e).slice(0, 500));
  });

  page.on("console", (msg) => {
    if (msg.type() === "error") {
      out.errors.push("console: " + msg.text().slice(0, 500));
    }
  });

  // Reload so listeners catch the whole boot.
  await page.reload({ waitUntil: "load" });
  await page.waitForTimeout(2500);

  out.globals = await page.evaluate(() => ({
    datum: typeof window.datum,
    engg: typeof window.enggDrawing,
  }));

  return out;
}

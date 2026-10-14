export default async function run(page) {
  const out = { js: [], failed: [] };

  page.on("requestfailed", (r) => {
    if (r.url().includes(".js")) {
      out.failed.push({
        url: r.url().replace("http://localhost:5173", ""),
        error: String(r.failure()?.errorText || ""),
      });
    }
  });

  page.on("response", (r) => {
    if (r.url().includes(".js") && r.status() >= 400) {
      out.failed.push({
        url: r.url().replace("http://localhost:5173", ""),
        status: r.status(),
      });
    }
  });

  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1500);

  out.requests = await page.evaluate(() =>
    performance
      .getEntriesByType("resource")
      .filter((e) => e.name.includes(".js"))
      .map((e) => e.name.replace("http://localhost:5173", ""))
      .slice(0, 40),
  );

  out.scripts = await page.evaluate(() =>
    Array.from(document.querySelectorAll("script[type=module]")).map((s) =>
      s.getAttribute("src"),
    ),
  );

  out.globals = await page.evaluate(() => ({
    datum: typeof window.datum,
    engg: typeof window.enggDrawing,
  }));

  return out;
}

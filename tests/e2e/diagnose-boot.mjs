/*
 * Captures the start-up error by installing listeners BEFORE the page loads.
 *
 * The earlier probes attached after navigation had already finished, so a
 * failure during module evaluation was never heard. This navigates explicitly,
 * with the listeners already in place, and reports everything the page said.
 */
export default async function run(page, ui) {
  const events = [];

  page.on("pageerror", (e) =>
    events.push({
      kind: "pageerror",
      text: e.message,
      stack: (e.stack || "").split("\n").slice(0, 5).join(" | "),
    }),
  );
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") {
      events.push({ kind: `console.${m.type()}`, text: m.text() });
    }
  });
  page.on("requestfailed", (r) =>
    events.push({
      kind: "requestfailed",
      text: `${r.url()} :: ${r.failure()?.errorText}`,
    }),
  );

  await page.goto("http://localhost:5173/", { waitUntil: "load" });
  await page.waitForTimeout(2500);

  const state = await page.evaluate(() => ({
    datum: typeof window.datum,
    hooks: typeof window.enggDrawingStateLive,
    menuItems: document.getElementById("datumMenuBar")?.children.length ?? -1,
    appErrorLog: window.enggErrorLog
      ? (window.enggErrorLog.read?.() ?? "present")
      : "absent",
  }));

  return { state, events };
}

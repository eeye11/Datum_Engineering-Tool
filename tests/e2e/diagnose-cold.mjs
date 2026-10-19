/*
 * Watches the entry module load on a COLD page and reports which of its own
 * side effects actually happened.
 *
 * The manual re-import works, so the module body is correct. This checks the
 * cold load specifically, and records the drawing workspace's own render state
 * - the strongest available signal of how far start-up got.
 */
export default async function run(page) {
  const events = [];
  page.on("pageerror", (e) => events.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") events.push(`console: ${m.text()}`);
  });

  await page.goto("http://localhost:5173/", { waitUntil: "load" });
  await page.waitForTimeout(3000);

  const state = await page.evaluate(() => ({
    hooks: typeof window.enggDrawingStateLive,
    datum: typeof window.datum,
    // Did index.js's render steps run?
    toolButtons: document.querySelectorAll("#drawing .drawing-tool").length,
    sheetTabs: document.querySelectorAll("[data-sheet-id]").length,
    // Is the drawing section even active/visible?
    drawingClass: document.getElementById("drawing")?.className,
    drawingVisible: (() => {
      const d = document.getElementById("drawing");
      if (!d) return "absent";
      const r = d.getBoundingClientRect();
      return `w=${Math.round(r.width)} h=${Math.round(r.height)}`;
    })(),
    // How many modules did the browser fetch?
    srcModules: performance
      .getEntriesByType("resource")
      .filter((e) => e.name.includes("/src/")).length,
  }));

  return { state, events };
}
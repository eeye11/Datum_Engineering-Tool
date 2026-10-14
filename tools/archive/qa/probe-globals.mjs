export default async function run(page) {
  const errors = [];

  page.on("pageerror", (e) => errors.push(String((e && e.message) || e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push("console: " + m.text());
  });

  /* Load main.js explicitly, the way the page does. */
  const result = await page.evaluate(async () => {
    const out = {};

    try {
      await import("/src/main.js");
      out.imported = true;
    } catch (error) {
      out.importError = String((error && error.message) || error);
    }

    await new Promise((r) => setTimeout(r, 600));

    out.datum = typeof window.datum;
    out.drawing = typeof window.enggDrawing;
    out.drawingState = typeof window.enggDrawingState;
    out.loadProfile = typeof window.enggLoadProfile;
    out.transforms = typeof window.enggTransforms;

    return out;
  });

  return { errors, result };
}

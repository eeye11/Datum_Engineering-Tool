/*
 * Bisect the module graph: import each of main.js's own imports in turn and
 * report which one does not settle.
 */
const IMPORTS = [
  "/src/core/model/drawing-state.js",
  "/src/core/scale/dimensions.js",
  "/src/core/scale/scale-calibration.js",
  "/src/features/dimensions/dimension-model.js",
  "/src/features/annotations/annotation-model.js",
  "/src/file/document-file.js",
  "/src/file/file-save.js",
  "/src/editor/index.js",
  "/src/editor/toolbar.js",
  "/src/rendering/renderer.js",
  "/src/references/drawing-reference.js",
  "/src/sheets/sheet-tabs.js",
  "/src/solution/writing-tab.js"
];

export default async function run(page) {
  const results = {};

  for (const path of IMPORTS) {
    results[path] = await page.evaluate(async (p) => {
      try {
        await Promise.race([
          import(p).then(() => "ok"),
          new Promise((r) => setTimeout(() => r("TIMEOUT"), 2500))
        ]);
      } catch (e) {
        return "ERROR: " + String(e && e.message).slice(0, 120);
      }

      return await Promise.race([
        import(p).then(() => "ok"),
        new Promise((r) => setTimeout(() => r("TIMEOUT"), 2500))
      ]);
    }, path);
  }

  return results;
}

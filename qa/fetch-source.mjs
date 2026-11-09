export default async function run(page) {
  await page.waitForSelector(".drawing-category", { timeout: 120000 });

  return page.evaluate(async () => {
    const results = {};

    for (const url of [
      "/src/features/workspace/math/math-sketch-editor.js",
      "./src/features/workspace/math/math-sketch-editor.js",
    ]) {
      try {
        const response = await fetch(url, { cache: "no-store" });
        const text = await response.text();

        results[url] = {
          status: response.status,
          length: text.length,
          hasHook: text.includes("__datumSketch"),
          hasTrace: text.includes("__sketchTrace"),
          hasBounds: text.includes("data-sketch-bounds-mode"),
          tail: text.slice(-200).replace(/\s+/g, " "),
        };
      } catch (error) {
        results[url] = String(error);
      }
    }

    return results;
  });
}

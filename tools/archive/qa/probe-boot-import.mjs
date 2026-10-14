export default async function run(page) {
  const result = await page.evaluate(async () => {
    const out = {};

    /* Load main.js the way the PAGE does, with whatever query it used. */
    const tag = [...document.scripts].find((s) => /main\.js/.test(s.src));

    out.scriptSrc = tag ? tag.src : null;

    try {
      await import(out.scriptSrc);
      out.imported = true;
    } catch (error) {
      out.importError = String((error && error.stack) || error);
    }

    await new Promise((r) => setTimeout(r, 800));

    out.datum = typeof window.datum;
    out.drawing = typeof window.enggDrawing;

    return out;
  });

  return result;
}

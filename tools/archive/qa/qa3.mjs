/*
 * The scripts are in the DOM, correctly typed, the page is fully loaded,
 * there are no errors - and yet nothing they define exists.
 *
 * That combination has one usual cause: what I am looking at is not the
 * document the scripts belong to. Check for frames, and check what the
 * server actually served, before blaming the application.
 */
export default async function run(page, ui) {
  return await page.evaluate(() => {
    const scripts = [...document.querySelectorAll("script[src]")];

    return {
      url: location.href,

      /* Where do the drawing scripts actually think they are? */
      drawingScripts: scripts
        .filter((s) => s.src.includes("engineering-drawing"))
        .map((s) => s.src.replace(location.origin, "")),

      /* A frame would hold a separate window with its own globals. */
      frames: [...document.querySelectorAll("iframe")].map((f) => ({
        src: f.src,
        id: f.id,
        sameOrigin: (() => {
          try {
            return Boolean(f.contentDocument);
          } catch (e) {
            return false;
          }
        })(),
      })),

      /* Which view is showing? */
      bodyId: document.body.id || "(none)",
      title: document.title,

      /* Are the drawing scripts inside something that defers them? */
      parentTags: scripts
        .filter((s) => s.src.includes("engineering-drawing"))
        .map((s) => s.parentElement?.tagName || "?"),
    };
  });
}

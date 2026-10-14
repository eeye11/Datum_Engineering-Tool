/*
 * Do ANY scripts execute in this harness?
 *
 * The drawing modules are in the DOM as direct children of body, with no
 * console errors, on a fully-loaded page - and nothing they define exists.
 *
 * Before reporting that as an application fault, test whether a script I
 * add right now executes. If that does not run either, the harness is not
 * running page scripts at all, and every "the globals are missing" reading
 * above was an artefact of measuring that, not a defect in the app.
 */
export default async function run(page, ui) {
  return await page.evaluate(() => {
    const before = typeof window.__canary;

    window.__canary = "inline-eval";

    /* 1. Does an INLINE eval statement run? It already did. */

    /* 2. Does an injected external script tag execute? */
    const results = { inline: window.__canary };

    const tag = document.createElement("script");

    tag.src = "/js/engineering-drawing/measurement-core.js";

    return new Promise((resolve) => {
      tag.onload = () => {
        setTimeout(() => {
          results.externalLoaded = true;
          results.measurementAfterLoad = typeof window.enggMeasurement;

          /*
           * The decisive comparison: the SAME file, as a tag in the
           * document, versus a tag added now. If the document one never
           * ran and this one does, the problem is in how the page was
           * built, not in the file.
           */
          resolve(results);
        }, 300);
      };

      tag.onerror = () => {
        results.externalError = "load failed";

        resolve(results);
      };

      document.head.appendChild(tag);
    });
  });
}

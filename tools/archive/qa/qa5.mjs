/*
 * measurement-core.js is a plain IIFE assigning window.enggMeasurement.
 * If injecting it defines nothing, either the harness does not execute
 * page scripts, or the assignment is not reaching `window`.
 *
 * A trivial inline script separates those two.
 */
export default async function run(page, ui) {
  return await page.evaluate(() => {
    const out = {};

    /* A. An inline script element - the simplest possible execution. */
    window.__inlineCanary = "set-directly";

    const inline = document.createElement("script");

    inline.textContent = 'window.__inlineCanary = "ran-in-inline-tag";';

    document.head.appendChild(inline);

    out.inlineCanary = window.__inlineCanary;

    /* B. Does the module IIFE run at all? Give it a marker it must set. */
    const marker = document.createElement("script");

    marker.textContent =
      "window.__iifeCanary = (function(){ " +
      "window.enggMeasurement = {probe:true}; " +
      'return "iife-ran"; })();';

    document.head.appendChild(marker);

    out.iifeCanary = window.__iifeCanary;

    /*
     * C. The real file, injected - and its exports read straight after,
     * with no setTimeout in between. The earlier run waited 300ms, which
     * is a chance for something else to happen.
     */
    const tag = document.createElement("script");

    tag.src = "/js/engineering-drawing/measurement-core.js";

    return new Promise((resolve) => {
      tag.onload = () => {
        out.measurementSync = typeof window.enggMeasurement;

        setTimeout(() => {
          out.measurementLater = typeof window.enggMeasurement;

          out.exports = window.enggMeasurement
            ? Object.keys(window.enggMeasurement).length
            : 0;

          resolve(out);
        }, 500);
      };

      tag.onerror = () => {
        out.loadError = true;

        resolve(out);
      };

      document.head.appendChild(tag);
    });
  });
}

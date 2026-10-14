/*
 * ========================================================
 * A PRINT PASS CANNOT COVER THE APPLICATION
 * ========================================================
 *
 * The bug: printing appends a full-size fitted drawing to the page, hidden only
 * inside `@media print`. If the cleanup never runs - and `afterprint` is the
 * event browsers fire LEAST reliably - the drawing stays on screen, covers the
 * editor and swallows every click. That is what "a fitted diagram on the whole
 * page" and "Open doesn't work" both were.
 *
 * Two independent guarantees must hold:
 *   1. the host is hidden ON SCREEN the moment it is added, and
 *   2. it is cleaned up by several events, not one.
 */

export default async function run(page) {
  const errors = [];

  page.on("pageerror", (e) => errors.push(String((e && e.message) || e)));

  await page.waitForFunction(
    () => typeof window.enggDrawing === "object" && window.enggDrawing.state,
    null,
    { timeout: 60000 },
  );

  await page.waitForTimeout(500);

  /* Draw something, then print. window.print is stubbed so no dialog opens. */
  const during = await page.evaluate(async () => {
    const ds = window.enggDrawingState;
    const st = window.enggDrawing.state;
    const F = ds.geometryFactories;

    const before = ds.snapshotDrawing(st);
    st.objects = [];

    const a = F.line({ x: 0, y: 0 }, { x: 120, y: 0 }, { style: {} });
    a.id = "p1";
    st.objects.push(a);
    ds.commitDrawingChange(st, before);

    window.__qaPrintCalled = false;
    window.print = () => {
      window.__qaPrintCalled = true;
    };

    document.querySelector('[data-file-action="print"]').click();

    await new Promise((r) => setTimeout(r, 400));

    const host = document.getElementById("drawing-print-host");

    const centre = document.elementFromPoint(
      window.innerWidth / 2,
      window.innerHeight / 2,
    );

    return {
      printCalled: window.__qaPrintCalled,
      hostPresent: Boolean(host),
      hostDisplay: host ? getComputedStyle(host).display : null,
      hostCovering: host
        ? (() => {
            const r = host.getBoundingClientRect();
            return r.width > 200 && r.height > 200;
          })()
        : false,
      topElementAtCentre: centre
        ? `${centre.tagName}.${String(centre.className || "").slice(0, 30)}`
        : null,
    };
  });

  /* A missed `afterprint` must still clean up - the safety timeout. */
  const afterTimeout = await page.evaluate(async () => {
    await new Promise((r) => setTimeout(r, 5600));

    return {
      hostStillPresent: Boolean(document.getElementById("drawing-print-host")),
      styleStillPresent: Boolean(
        document.getElementById("drawing-print-style"),
      ),
    };
  });

  /* And Open must still work afterwards. */
  const openWorks = await page.evaluate(async () => {
    document.querySelector('[data-file-action="open"]').click();
    await new Promise((r) => setTimeout(r, 700));

    return {
      dialogPresent: Boolean(document.querySelector(".engg-dialog")),
      dialogTitle: (document.querySelector(".engg-dialog-title") || {})
        .textContent,
    };
  });

  return { during, afterTimeout, openWorks, errors };
}

/*
 * Render the DAETUM mark large, on both a light and a dark ground, and report
 * the measurements a reader would take from the picture. Used to LOOK at the
 * symbol rather than to assert on it - the assertions live in
 * tests/daetum-mark.test.cjs.
 */
export default async function run(page, ui) {
  // The app's own stylesheet must be loaded so --logo-color resolves.
  const favicon = await page.evaluate(
    () =>
      document.querySelector('link[rel="icon"]')?.getAttribute("href") || null,
  );

  await page.setContent(`
    <html><head><style>
      body { margin: 0; display: flex; gap: 24px; align-items: center;
             background: #fff; font-family: sans-serif; }
      .cell { padding: 24px; }
      .dark { background: #142426; }
      .mark { color: #111827; }
      .mark-dark { color: #E8F5F3; }
      .row { display: flex; align-items: center; gap: 10px; margin-bottom: 18px; }
      .label { font-size: 13px; color: #555; }
      .label-dark { color: #A8C6C3; }
      .word { font-size: 16px; font-weight: 700; letter-spacing: -0.01em; }
      .word-dark { color: #E8F5F3; }
      .word-light { color: #193335; }
    </style></head><body>
      <div class="cell">
        <div class="row">
          <span class="mark" style="display:inline-flex">
            <svg id="bigLight" viewBox="0 0 24 24" width="96" height="96">
              <path fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" d="M12 2.5V21.5"/>
              <path fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" d="M6.5 12H17.5"/>
              <path fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" d="M4.725 7.8A8.4 8.4 0 1 1 4.725 16.2"/>
              <circle cx="12" cy="12" r="2.6" fill="currentColor"/>
            </svg>
          </span>
          <span class="word word-light">DAETUM</span>
        </div>
        <div class="row">
          <span class="mark" style="display:inline-flex">
            <svg viewBox="0 0 24 24" width="28" height="28">
              <path fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" d="M12 2.5V21.5"/>
              <path fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" d="M6.5 12H17.5"/>
              <path fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" d="M4.725 7.8A8.4 8.4 0 1 1 4.725 16.2"/>
              <circle cx="12" cy="12" r="2.6" fill="currentColor"/>
            </svg>
          </span>
          <span class="label">28 px - header size</span>
        </div>
        <div class="row">
          <span class="mark" style="display:inline-flex">
            <svg viewBox="0 0 24 24" width="16" height="16">
              <path fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" d="M12 2.5V21.5"/>
              <path fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" d="M6.5 12H17.5"/>
              <path fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" d="M4.725 7.8A8.4 8.4 0 1 1 4.725 16.2"/>
              <circle cx="12" cy="12" r="2.6" fill="currentColor"/>
            </svg>
          </span>
          <span class="label">16 px - favicon size</span>
        </div>
      </div>
      <div class="cell dark">
        <div class="row">
          <span class="mark-dark" style="display:inline-flex">
            <svg viewBox="0 0 24 24" width="96" height="96">
              <path fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" d="M12 2.5V21.5"/>
              <path fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" d="M6.5 12H17.5"/>
              <path fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" d="M4.725 7.8A8.4 8.4 0 1 1 4.725 16.2"/>
              <circle cx="12" cy="12" r="2.6" fill="currentColor"/>
            </svg>
          </span>
          <span class="word word-dark">DAETUM</span>
        </div>
        <div class="row">
          <span class="mark-dark" style="display:inline-flex">
            <svg viewBox="0 0 24 24" width="16" height="16">
              <path fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" d="M12 2.5V21.5"/>
              <path fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" d="M6.5 12H17.5"/>
              <path fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" d="M4.725 7.8A8.4 8.4 0 1 1 4.725 16.2"/>
              <circle cx="12" cy="12" r="2.6" fill="currentColor"/>
            </svg>
          </span>
          <span class="label label-dark">16 px on the dark ground</span>
        </div>
      </div>
    </body></html>
  `);

  // Wait for the SVG to lay out, then measure it geometrically.
  await page.waitForTimeout(300);

  const measured = await page.evaluate(() => {
    const svg = document.querySelector("#bigLight");
    const arc = svg.querySelector("path:nth-of-type(3)");
    const dot = svg.querySelector("circle");
    const box = svg.getBoundingClientRect();
    const dotBox = dot.getBoundingClientRect();
    return {
      renderedWidth: Math.round(box.width),
      renderedHeight: Math.round(box.height),
      dotDiameterPx: Number(dotBox.width.toFixed(2)),
      arcPath: arc.getAttribute("d"),
      dotIndex: [...svg.children].indexOf(dot) + 1,
      childCount: svg.children.length,
    };
  });

  return {
    faviconHrefIsDataUrl: Boolean(
      favicon && favicon.startsWith("data:image/svg+xml"),
    ),
    measured,
  };
}

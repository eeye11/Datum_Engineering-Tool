/*
 * Probe: does the moment's onConfirm fire at all, and with what?
 */
export default async function run(page) {
  const errs = [];
  page.on("pageerror", (e) =>
    errs.push("PAGEERROR: " + e.message.slice(0, 220)),
  );
  page.on("console", (m) => {
    if (m.type() === "error") errs.push("CONSOLE: " + m.text().slice(0, 180));
  });

  await page.evaluate(async () => {
    await import("/src/main.js");
  });
  await page.waitForFunction(
    () => !!(window.enggDrawing && window.enggDrawing.state),
    { timeout: 15000 },
  );

  const tab = page
    .locator("button", { hasText: "Engineering Drawing" })
    .first();
  if (await tab.count()) await tab.click();
  await page.waitForTimeout(900);

  await page.evaluate(() => {
    const st = window.enggDrawing.state;
    st.objects.length = 0;
    st.selection.selectedObjectIds = [];

    /*
     * WRAP THE POPUP, so the answer the moment's handler receives is
     * recorded regardless of how it was produced.
     */
    window.__seen = [];

    import("/src/ui/editors/load-value-popup.js").then((mod) => {
      const original = mod.openLoadValuePopup;

      window.__patched = true;

      try {
        // eslint-disable-next-line no-import-assign
        mod.openLoadValuePopup = (options) => {
          window.__seen.push({ opened: options.title });

          return original({
            ...options,
            onConfirm: (answer) => {
              window.__seen.push({ confirmed: answer });

              return options.onConfirm(answer);
            },
          });
        };
      } catch (error) {
        window.__patchError = String(error);
      }
    });
  });

  await page.waitForTimeout(300);

  return {
    patched: await page.evaluate(() => window.__patched === true),
    seen: await page.evaluate(() => window.__seen),
    errs,
  };
}

/*
 * Verify Save As invokes the NATIVE file picker and NOT a custom dialog.
 *
 * showSaveFilePicker is stubbed so the native panel cannot actually open in a
 * headless run, but the stub records what Datum asked it for. What is asserted
 * is that the button reaches that API - and that no application-owned Save As
 * dialog appears in the DOM.
 */
export default async function run(page) {
  const out = {};

  /* Switch to the Engineering Drawing workspace so the toolbar is live. */
  await page.evaluate(() => {
    const tabs = [...document.querySelectorAll("button.tab")];
    const hit = tabs.find((b) =>
      /engineering drawing/i.test(b.textContent || ""),
    );
    if (hit) hit.click();
  });

  await page.waitForTimeout(900);

  /* Stub the native picker and record the request. */
  await page.evaluate(() => {
    window.__pickerCalls = [];
    window.showSaveFilePicker = async (options) => {
      window.__pickerCalls.push(options);
      const error = new Error("cancelled");
      error.name = "AbortError";
      throw error;
    };
  });

  /* Click Save As. */
  await page.evaluate(() => {
    const button = document.querySelector('[data-file-action="save-as"]');
    if (button) button.click();
  });

  await page.waitForTimeout(500);

  out.pickerCalls = await page.evaluate(() => window.__pickerCalls || []);
  out.requestedTypes = (out.pickerCalls[0]?.types || []).flatMap((t) =>
    Object.values(t.accept).flat(),
  );
  out.suggestedName = out.pickerCalls[0]?.suggestedName;

  /* No custom Save As dialog may exist. */
  out.customDialog = await page.evaluate(() => {
    const text = document.body.innerText || "";
    const hasFileTypeLabel = /\bFile Type\b/.test(text);
    const hasFileNameLabel = /\bFile Name\b/.test(text);
    return { hasFileTypeLabel, hasFileNameLabel };
  });

  return out;
}
/*
 * Why does a referenced drawing fail to appear in the written solution?
 *
 * The reference path asks the TikZ service to compile the SHEET'S OWN SOURCE and
 * inserts the returned SVG. This compares, on the same page:
 *
 *   - the sheet's stored source (what is sent to the service),
 *   - the service's answer for it,
 *   - the figure the written solution ends up showing.
 */
export default async function run(page) {
  await page.evaluate(() => document.querySelector('.tab[data-tab="writing"]')?.click());
  await page.waitForTimeout(600);

  await page.evaluate(() => {
    const editor = document.getElementById("solutionEditor");

    editor.value = "The free body diagram is shown below.\n";
    editor.dispatchEvent(new Event("input", { bubbles: true }));
    editor.setSelectionRange(editor.value.length, editor.value.length);

    document.getElementById("solutionEnterDrawing")?.click();
  });

  await page.waitForTimeout(400);

  await page.evaluate(() => {
    [...document.querySelectorAll(".engg-dialog button")]
      .find((button) => button.textContent.trim() === "Draw a new figure")
      ?.click();
  });

  await page.waitForTimeout(1500);

  const sheets = await page.evaluate(() => globalThis.datum?.listSheets?.() || []);

  await page.evaluate(() => document.querySelector('.tab[data-tab="drawing"]')?.click());
  await page.waitForTimeout(600);

  const stored = await page.evaluate(() => {
    const area = document.querySelector("#drawingSourceEditor textarea");

    return area ? area.value.slice(0, 900) : null;
  });

  await page.evaluate(() => document.querySelector('.tab[data-tab="writing"]')?.click());
  await page.waitForTimeout(2500);

  const preview = await page.evaluate(() => {
    const node = document.getElementById("solutionPreview");
    const figure = node?.querySelector(".drawing-reference-figure");

    return {
      previewText: node?.innerText?.slice(0, 700),
      figureHtml: figure?.innerHTML?.slice(0, 900) || null,
      svgCount: node?.querySelectorAll("svg").length,
      referenceCount: document.querySelectorAll(".solution-drawing-chip").length,
    };
  });

  const answered = await page.evaluate(async (tikz) => {
    if (!tikz) {
      return { skipped: true };
    }

    const response = await fetch("/api/render-tikz", {
      body: JSON.stringify({ tikz }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });

    let payload = null;

    try {
      payload = await response.json();
    } catch {
      payload = { unreadable: true };
    }

    return {
      status: response.status,
      success: payload?.success,
      error: payload?.error,
      svgStart: String(payload?.svg || "").slice(0, 200),
    };
  }, stored);

  return { sheets, stored, preview, answered };
}

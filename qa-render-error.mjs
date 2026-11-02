/*
 * Enter a drawing into the written solution, then look at what the preview does.
 *
 * The question is the error message the student sees in the rendered figure -
 * so the run records the console, the render request's response, and the
 * figure's own text.
 */
export default async function run(page) {
  await page.evaluate(() =>
    document.querySelector('.tab[data-tab="writing"]')?.click(),
  );
  await page.waitForTimeout(700);

  const requests = [];

  page.on("response", async (response) => {
    if (response.url().includes("/api/render-tikz")) {
      let body = null;

      try {
        body = await response.text();
      } catch {
        body = "<unreadable>";
      }

      requests.push({
        status: response.status(),
        body: String(body).slice(0, 400),
      });
    }
  });

  /* Make a drawing with something on it, through the real workflow. */
  await page.evaluate(() => {
    const editor = document.getElementById("solutionEditor");

    editor.value = "The free body diagram is shown below.\n";
    editor.dispatchEvent(new Event("input", { bubbles: true }));
    editor.setSelectionRange(editor.value.length, editor.value.length);
  });

  await page.evaluate(() =>
    document.getElementById("solutionEnterDrawing")?.click(),
  );
  await page.waitForTimeout(400);

  await page.evaluate(() => {
    [...document.querySelectorAll(".engg-dialog button")]
      .find((button) => button.textContent.trim() === "Draw a new figure")
      ?.click();
  });

  await page.waitForTimeout(1500);

  /* Draw a line on the new sheet so it is not empty. */
  const drew = await page.evaluate(() => {
    const state = document.querySelector('.tab[data-tab="drawing"]');
    state?.click();

    return true;
  });

  await page.waitForTimeout(600);

  const added = await page.evaluate(() => {
    /* The drawing model is exposed by the workspace for automation. */
    const model = globalThis.enggDrawingState;
    const app = globalThis.enggDrawing;

    if (!model || !app?.state) {
      return { ok: false, reason: "no model on the page" };
    }

    const object = model.geometryFactories.line(
      { x: 0, y: 0 },
      { x: 120, y: 0 },
      {},
    );

    model.addObject(app.state, object);
    model.commitDrawingChange(app.state, model.snapshotDrawing(app.state));

    return { ok: true, objects: app.state.objects.length };
  });

  await page.waitForTimeout(1200);

  await page.evaluate(() =>
    document.querySelector('.tab[data-tab="writing"]')?.click(),
  );
  await page.waitForTimeout(2500);

  const preview = await page.evaluate(() => {
    const node = document.getElementById("solutionPreview");
    const figure = node?.querySelector(
      ".linked-drawing-figure, .drawing-reference-figure",
    );

    return {
      source: document.getElementById("solutionEditor")?.value,
      previewText: node?.innerText?.slice(0, 600),
      figureHtml: figure?.innerHTML?.slice(0, 800) || null,
      svgCount: node?.querySelectorAll("svg").length,
      classes: [
        ...(node?.querySelectorAll('[class*="drawing-reference"]') || []),
      ].map((el) => el.className),
    };
  });

  return { drew, added, requests, preview };
}

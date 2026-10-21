export default async function run(page) {
  await page.evaluate(() => document.querySelector('.tab[data-tab="writing"]')?.click());
  await page.waitForTimeout(700);
  await page.evaluate(() => {
    const editor = document.getElementById("solutionEditor");
    editor.value = "Text.\n"; editor.dispatchEvent(new Event("input", { bubbles: true }));
    editor.setSelectionRange(editor.value.length, editor.value.length);
    document.getElementById("solutionEnterDrawing")?.click();
  });
  await page.waitForTimeout(500);
  await page.evaluate(() => [...document.querySelectorAll(".engg-dialog button")].find(b => b.textContent.trim() === "Draw a new figure")?.click());
  await page.waitForTimeout(1500);
  await page.evaluate(() => document.querySelector('.tab[data-tab="drawing"]')?.click());
  await page.waitForTimeout(700);
  const added = await page.evaluate(() => {
    const model = globalThis.enggDrawingState;
    const state = globalThis.enggDrawingStateLive;
    if (!model || !state) return { ok: false, model: Boolean(model), state: Boolean(state) };
    const obj = model.geometryFactories.line({ x: 0, y: 0 }, { x: 120, y: 40 }, {});
    model.addObject(state, obj);
    model.commitDrawingChange(state, model.snapshotDrawing(state));
    return { ok: true, objects: state.objects.length };
  });
  await page.waitForTimeout(1200);
  await page.evaluate(() => document.querySelector('.tab[data-tab="writing"]')?.click());
  await page.waitForTimeout(3500);
  const out = await page.evaluate(() => {
    const node = document.getElementById("solutionPreview");
    const fig = node?.querySelector(".drawing-reference-figure");
    return { addedSentinel: document.title, figureHtml: fig?.innerHTML?.slice(0, 600) || null, svgCount: node?.querySelectorAll("svg").length, text: node?.innerText?.slice(-260) };
  });
  return { added, out };
}

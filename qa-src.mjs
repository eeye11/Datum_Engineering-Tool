export default async function run(page) {
  await page.evaluate(() => document.querySelector('.tab[data-tab="drawing"]')?.click());
  await page.waitForTimeout(800);
  const before = await page.evaluate(() => {
    const sheets = globalThis.enggDrawingSheets?.all?.() || [];
    return sheets.map(s => ({ id: s.id, name: s.name, hasSource: Boolean(s.source), src: s.source?.source?.slice(0,120) }));
  });
  const added = await page.evaluate(() => {
    const model = globalThis.enggDrawingState;
    const state = globalThis.enggDrawingStateLive;
    if (!model || !state) return { ok: false };
    const obj = model.geometryFactories.line({ x: 0, y: 0 }, { x: 120, y: 40 }, {});
    model.addObject(state, obj);
    model.commitDrawingChange(state, model.snapshotDrawing(state));
    return { ok: true };
  });
  await page.waitForTimeout(1500);
  const after = await page.evaluate(() => {
    const sheets = globalThis.enggDrawingSheets?.all?.() || [];
    return sheets.map(s => ({ id: s.id, hasSource: Boolean(s.source), src: s.source?.source?.slice(0,200) }));
  });
  return { before, added, after };
}

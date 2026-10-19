// QA: does the Geometry -> Reference Arc submenu arm a real tool
// (instead of the Phase-1 placeholder message)?
export default async function run(page, ui) {
  await page.waitForTimeout(1500);

  let snap = await ui.snapshot();
  const eng = snap.match(/@(e\d+) button "Engineering Drawing"/)?.[1];
  if (eng) {
    await ui.click(eng);
    await page.waitForTimeout(800);
    snap = await ui.snapshot();
  }

  const geom = snap.match(/@(e\d+) button "Geometry"/)?.[1];
  if (!geom) return { error: 'no Geometry toolbar button', snap: snap.slice(0, 3000) };

  await ui.click(geom);
  await page.waitForTimeout(400);

  const snap2 = await ui.snapshot();
  const ref = snap2.match(/@(e\d+) \S+ "Reference"/)?.[1];
  if (!ref) return { step: 'opened Geometry', error: 'no Reference entry', snap2: snap2.slice(0, 3000) };

  await ui.click(ref);
  await page.waitForTimeout(400);

  const snap3 = await ui.snapshot();
  const refArc = snap3.match(/@(e\d+) \S+ "Reference Arc"/)?.[1];
  if (!refArc) return { step: 'opened Reference', error: 'no Reference Arc entry', snap3: snap3.slice(0, 3000) };

  await ui.click(refArc);
  await page.waitForTimeout(500);

  // A real armed tool shows an instruction, never the placeholder notice.
  const armed = await page.evaluate(() => {
    const text = document.body.innerText || '';
    return {
      hasPlaceholder: /not yet|placeholder|coming soon|removed ahead|LaTeX tool library/i.test(text),
      instruction: (document.querySelector('[data-testid=canvas-hint]') || {}).innerText || null,
      activeTool: document.querySelector('[aria-pressed=true][data-tool]')?.getAttribute('data-tool') || null,
      bodySample: text.slice(0, 400)
    };
  });

  return { reached: 'clicked Reference Arc', armed };
}

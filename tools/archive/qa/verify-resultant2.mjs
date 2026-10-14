export default async function run(page, ui) {
  await page.goto("http://localhost:8099/", { waitUntil: "load" });
  await page.waitForTimeout(2000);
  const tab = page
    .locator("button", { hasText: "Engineering Drawing" })
    .first();
  if (await tab.count()) await tab.click();
  await page.waitForTimeout(1500);

  return await page
    .evaluate(() => {
      const s = document.createElement("script");
      s.textContent = `
    (function(){
      const F = window.enggDrawingState.geometryFactories;
      const A = window.enggAnnotationModel;
      const S = window.enggSmartDimension;
      const R = {};

      // A resultant, exactly as the tool now builds it.
      const resultant = F.resultant({ x: 0, y: 0 }, { x: 30, y: 40 });
      let scene = { scale: { mmPerUnit: 1, unit: 'mm' }, objects: [resultant] };
      R.feature = { type: resultant.type, name: resultant.name,
                    magnitude: Math.round(resultant.geometry.magnitude),
                    angle: Math.round(resultant.geometry.angle) };

      // The annotation kind that previously had nothing to attach to.
      const label = F.annotation({
        kind: 'resultant-value',
        sourceFeatureId: resultant.id,
        position: { x: 40, y: 50 }
      });
      R.resolves = A.textFor(label, scene);

      // And it must FOLLOW the feature.
      resultant.geometry.magnitude = 500;
      resultant.geometry.angle = 0;
      R.afterChange = A.textFor(label, scene);

      // The components annotation on a force.
      const force = F.force({ x: 0, y: 0 }, { x: 0, y: -30 });
      force.geometry.magnitude = 250; force.geometry.angle = -90; force.geometry.unit = 'N';
      const fc = F.annotation({ kind: 'force-components', sourceFeatureId: force.id, position: { x: 5, y: -40 } });
      const fscene = { scale: { mmPerUnit: 1, unit: 'mm' }, objects: [force] };
      R.components = A.textFor(fc, fscene);
      force.geometry.angle = 30;
      R.componentsAfter = A.textFor(fc, fscene);

      // Dimensionable too?
      R.dimensionCandidates = S.candidatesFor(resultant);
      const d = F.dimension({ dimensionType: 'linear',
        refs: [{ kind: 'between', featureId: resultant.id, anchor: 'start' },
               { kind: 'between', featureId: resultant.id, anchor: 'end' }],
        placement: { x: 0, y: -20 } });
      R.dimensionReads = window.enggDimensionModel.formatMeasurement(d, scene);
      R.dimensionGraphics = !!window.enggDimensionModel.graphicsFor(d, scene);

      document.documentElement.setAttribute('data-res', JSON.stringify(R));
    })();`;
      document.body.appendChild(s);
      return null;
    })
    .then(() => page.getAttribute("html", "data-res"))
    .then((v) => JSON.parse(v || "null"));
}

export default async function run(page, ui) {
  const out = {};
  await page.reload({ waitUntil: "load" });
  await page.waitForTimeout(2000);
  const tab = page
    .locator("button", { hasText: "Engineering Drawing" })
    .first();
  if (await tab.count()) await tab.click();
  await page.waitForTimeout(1500);

  out.modules = await page.evaluate(() => {
    const k = [];
    for (const n in window) if (/^engg/i.test(n)) k.push(n);
    return k.sort();
  });

  // Run the acceptance checks inside the page against the real modules.
  out.checks = await page.evaluate(() => {
    const R = {};
    const M = window.enggMeasurement,
      D = window.enggDimensionModel,
      A = window.enggAnnotationModel,
      S = window.enggSmartDimension;

    // 1. Geometry dimension candidates
    const feats = {
      line: {
        id: "l1",
        type: "line",
        geometry: { x1: 0, y1: 0, x2: 100, y2: 0 },
      },
      circle: { id: "c1", type: "circle", geometry: { cx: 0, cy: 0, r: 25 } },
      arc: {
        id: "a1",
        type: "arc",
        geometry: { cx: 0, cy: 0, r: 25, startAngle: 0, endAngle: Math.PI / 2 },
      },
      rect: {
        id: "r1",
        type: "rectangle",
        geometry: { x1: 0, y1: 0, x2: 80, y2: 40 },
      },
      beam: {
        id: "b1",
        type: "beam",
        geometry: { x1: 0, y1: 0, x2: 400, y2: 0, depth: 20 },
      },
      pointForce: {
        id: "pf1",
        type: "point-force",
        geometry: { x: 10, y: 20, angle: 30, magnitude: 250, unit: "N" },
      },
    };
    R.dimensionCandidates = {};
    R.annotationCandidates = {};
    for (const k in feats) {
      try {
        R.dimensionCandidates[k] = M.dimensionCandidates(feats[k]);
      } catch (e) {
        R.dimensionCandidates[k] = "ERR " + e.message;
      }
      try {
        R.annotationCandidates[k] = M.annotationCandidates(feats[k]);
      } catch (e) {
        R.annotationCandidates[k] = "ERR " + e.message;
      }
    }

    // 2. Associative dimension value: change geometry, value must follow
    try {
      const st = { scale: { mmPerUnit: 1, unit: "mm" } };
      const mk = (x2) => ({
        id: "l1",
        type: "line",
        geometry: { x1: 0, y1: 0, x2, y2: 0 },
      });
      R.assocValue100 = D.measureValue
        ? D.measureValue(
            {
              dimensionType: "linear",
              sourceRefs: [
                { featureId: "l1", anchor: "line.start" },
                { featureId: "l1", anchor: "line.end" },
              ],
            },
            { resolve: () => mk(100) },
            st,
          )
        : "no measureValue";
      R.assocValue140 = D.measureValue
        ? D.measureValue(
            {
              dimensionType: "linear",
              sourceRefs: [
                { featureId: "l1", anchor: "line.start" },
                { featureId: "l1", anchor: "line.end" },
              ],
            },
            { resolve: () => mk(140) },
            st,
          )
        : "no measureValue";
    } catch (e) {
      R.assoc = "ERR " + e.message;
    }

    // 3. Annotation created & linked
    try {
      const a = A.createAnnotation({
        annotationKind: "force-magnitude",
        sourceFeatureId: "pf1",
      });
      R.ann = {
        id: a.id,
        text: a.text,
        hasSource: a.sourceFeatureId === "pf1",
        placementMode: a.placementMode,
        keys: Object.keys(a).sort(),
      };
    } catch (e) {
      R.ann = "ERR " + e.message;
    }

    // 4. Smart dimension redundancy
    try {
      R.smartApi = Object.keys(S).sort();
    } catch (e) {
      R.smartApi = "ERR " + e.message;
    }
    try {
      R.dimApi = Object.keys(D).sort();
    } catch (e) {
      R.dimApi = "ERR " + e.message;
    }
    try {
      R.annApi = Object.keys(A).sort();
    } catch (e) {
      R.annApi = "ERR " + e.message;
    }

    return R;
  });

  return out;
}

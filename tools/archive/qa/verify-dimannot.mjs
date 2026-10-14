// Verifies the EnggDraw dimension/annotation system in the real browser.
const q = (page, fn, arg) => page.evaluate(fn, arg);

export default async function run(page, ui) {
  const out = { steps: [] };
  const log = (k, v) => out.steps.push(k + ": " + JSON.stringify(v));

  await page.waitForFunction(() => !!window.enggDimensionModel, null, {
    timeout: 15000,
  });

  // --- Models present ---
  log("modules", {
    measurement: !!window.enggMeasurement,
    dimensionModel: !!window.enggDimensionModel,
    annotationModel: !!window.enggAnnotationModel,
    smartDimension: !!window.enggSmartDimension,
  });

  // --- A real associative dimension on a line ---
  const dim = await q(page, () => {
    const m = window.enggMeasurement;
    const line = {
      id: "line_1",
      type: "line",
      geometry: { x1: 0, y1: 0, x2: 100, y2: 0 },
    };
    const cands = m.dimensionCandidates(line);
    const d = window.enggDimensionModel.createDimension({
      dimensionType: "linear",
      sourceRefs: [{ featureId: "line_1", anchor: "line.start" }],
      label: "len",
    });
    return { candidates: cands, id: d.id, type: d.dimensionType };
  });
  log("dimension", dim);

  // --- Associativity: move the line endpoint, dimension must update ---
  const assoc = await q(page, () => {
    const m = window.enggMeasurement;
    const line = {
      id: "line_1",
      type: "line",
      geometry: { x1: 0, y1: 0, x2: 140, y2: 0 },
    };
    const a = m.anchorOptions(line);
    const val = m.measure ? m.measure(line, "linear") : null;
    return { anchors: a, value: val };
  });
  log("associative", assoc);

  // --- Annotation content from a point force ---
  const annot = await q(page, () => {
    const pf = {
      id: "pf_1",
      type: "point-force",
      geometry: { x: 10, y: 20, angle: 30, magnitude: 250, unit: "N" },
    };
    const cands = window.enggMeasurement.annotationCandidates(pf);
    const a = window.enggAnnotationModel.createAnnotation({
      annotationKind: "force-magnitude",
      sourceFeatureId: "pf_1",
    });
    return {
      candidates: cands,
      id: a.id,
      text: a.text,
      placementMode: a.placementMode,
    };
  });
  log("annotation", annot);

  // --- UI: are the Annotate tools actually present? ---
  const uiTools = await q(page, () => {
    const all = [
      ...document.querySelectorAll("button,[data-tool],[role=button],a"),
    ]
      .map((e) =>
        (
          e.getAttribute("title") ||
          e.getAttribute("aria-label") ||
          e.textContent ||
          ""
        ).trim(),
      )
      .filter(Boolean);
    return {
      dimension: all.filter((s) => /dimension/i.test(s)),
      annotation: all.filter((s) => /annotat|label|note|text/i.test(s)),
    };
  });
  log("uiTools", uiTools);

  out.bodyChars = await q(page, () => document.body.innerText.length);
  return out;
}

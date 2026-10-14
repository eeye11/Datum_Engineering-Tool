import { makeHelpers } from "./qa-helpers.mjs";

/*
 * Opens the Sketch editor on a diagram that has body-element references, and
 * reports the workspace layout and the graph's ticks.
 */
export default async function run(page) {
  const out = {};
  const h = await makeHelpers(page);

  /*
   * Build a beam, an SFD on it, and the diagram's reference stations from
   * the same shared functions the application uses - then open its Sketch.
   */
  const built = await h.evalInPage(
    page,
    `
    var st = window.enggDrawing.state;
    var deps = window.enggAnalysisDependencies;

    var beam = window.enggDrawing.geometryFactories.beam(
      { x: 0, y: 0 }, { x: 600, y: 0 }, { style: {} });
    st.objects.push(beam);

    var force = window.enggDrawing.geometryFactories.force(
      { x: 200, y: 0 }, { x: 200, y: 60 }, { style: {} });
    force.parentId = beam.id;
    st.objects.push(force);

    var span = deps.spanOf(beam);
    var stations = deps.sourceStations(beam, st);

    document.documentElement.setAttribute("data-qa", JSON.stringify({
      beamId: beam.id,
      hasSpan: Boolean(span),
      stations: (stations || []).map(function (s) {
        return { key: s.key, label: s.label, t: s.t };
      })
    }));`,
  );

  out.built = built;

  // Open the Sketch editor through the module the tree uses.
  const opened = await h.evalInPage(
    page,
    `
    var st = window.enggDrawing.state;
    var beam = null;
    st.objects.forEach(function (o) { if (o.type === "beam") beam = o; });
    var deps = window.enggAnalysisDependencies;

    var diagram = {
      id: "diagram-1",
      type: "analysis-diagram",
      name: "SFD 1",
      geometry: {
        diagramType: "sfd",
        localRange: { from: 0, to: 600 },
        sketchElements: [],
        referencePositions: deps.sourceStations(beam, st).map(function (s) {
          return { key: s.key, label: s.label, t: s.t, position: { x: s.t * 600, y: 0 } };
        })
      },
      engineering: { discipline: "statics", staticsType: "shear-force-diagram" }
    };

    st.objects.push(diagram);

    window.enggSketchEditor.open({
      title: "SFD - Sketch",
      range: diagram.geometry.localRange,
      elements: [],
      stations: diagram.geometry.referencePositions,
      onPreview: function () {},
      onApply: function () {},
      onCancel: function () {}
    });

    document.documentElement.setAttribute("data-qa", JSON.stringify({ opened: true }));`,
  );

  out.opened = opened;
  await page.waitForTimeout(400);

  out.layout = await page.evaluate(() => {
    const dialog = document.querySelector(".sketch-editor");
    if (!dialog) return null;

    const graph = dialog.querySelector(
      ".sketch-editor-graph-area, .sketch-editor-graph",
    );
    const lower = dialog.querySelector(".sketch-editor-lower");
    const tools = dialog.querySelector(
      ".sketch-editor-lower .plot-editor-left",
    );
    const props = dialog.querySelector(
      ".sketch-editor-lower .plot-editor-right",
    );

    const box = (el) =>
      el
        ? (function () {
            const r = el.getBoundingClientRect();
            return {
              x: Math.round(r.x),
              y: Math.round(r.y),
              w: Math.round(r.width),
              h: Math.round(r.height),
            };
          })()
        : null;

    const d = dialog.getBoundingClientRect();

    return {
      dialog: { w: Math.round(d.width), h: Math.round(d.height) },
      graph: box(graph),
      lower: box(lower),
      tools: box(tools),
      props: box(props),
      ticks: dialog.querySelectorAll(".sketch-editor-tick").length,
    };
  });

  return out;
}

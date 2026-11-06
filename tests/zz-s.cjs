const path = require("path");
const { JSDOM } = require("jsdom");
const projectRoot = path.join(__dirname, "..");
const { createHarness } = require("./harness-renderer.cjs");
createHarness(projectRoot, JSDOM, require);
[
  "drawingToolMessage",
  "drawingToolHeading",
  "drawingToolList",
  "drawingCoordinates",
  "drawingZoomValue",
].forEach((id) => {
  const e = globalThis.document.createElement("div");
  e.id = id;
  globalThis.document.body.appendChild(e);
});
const cv = globalThis.document.createElement("div");
cv.className = "drawing-canvas";
globalThis.document.body.appendChild(cv);
const { loadModule } = require("./helpers/source-path.cjs");
const dsMod = loadModule("drawing-state.js");
const ds = dsMod.default || dsMod;
const creation = loadModule("geometry-creation.js");
const selection = loadModule("selection.js");
const es = loadModule("editor-state.js");
const syncMod = loadModule("source-object-sync.js");
const sync = syncMod.default || syncMod;
const writerMod = loadModule("source-writers/geometry.js");
(writerMod.default || writerMod).installGeometrySourceWriter({
  setSourceWriter: loadModule("source-synchronization.js").setSourceWriter,
});
syncMod.setSourceGeometryFactories(ds.geometryFactories);
const schema = loadModule("feature-schema.js");
const sm = loadModule("source-model.js");
const state = es.drawingState;
state.objects = [];
state.activeTool = "freeform-polygon";
state.camera.zoom = 1;
ds.clearSelection(state);
ds.clearInteraction(state);
[
  [0, 0],
  [80, 0],
  [80, 40],
  [40, 40],
  [40, 80],
  [0, 80],
].forEach(([x, y]) =>
  creation.beginOrCompleteGeometry({
    effectiveConstructionPoint: { x, y },
    rawPointerPoint: { x, y },
    modifiers: {},
  }),
);
selection.finishActiveConstruction();
const poly = state.objects[0];
schema.writeField(poly, "stroke", "#123456");
const src = sync.sourceForObjectRegion(
  poly,
  "\\begin{tikzpicture}[x=1mm, y=1mm]\n\\end{tikzpicture}",
  { allObjects: state.objects },
);
console.log(src);
console.log("--- statements ---");
const map = loadModule("drawing-source.js").createSourceMap(src);
sm.blockContents(src, map).blocks.forEach((b) =>
  b.statements.forEach((st) =>
    console.log(
      JSON.stringify(st.text.slice(0, 60)),
      "=>",
      st.shape && st.shape.type,
      st.shape && st.shape.stroke,
    ),
  ),
);

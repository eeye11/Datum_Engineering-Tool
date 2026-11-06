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
const sm = loadModule("source-model.js");
const map = require(
  path.join(projectRoot, "src/shared/rendering/latex/drawing-source.js"),
);
const c = sm.blockContents(
  "% DAETUM_OBJECT_BEGIN id1 freeform-polygon\n% DAETUM OBJECT: P\n% DAETUM ID: id1\n% DAETUM TYPE: freeform-polygon\n\\definecolor{daetumC123456}{RGB}{18,52,86}\n\\draw[draw=daetumC123456] (0,50) -- (40,0) -- (80,50) -- cycle;\n% DAETUM_OBJECT_END id1\n",
  map.createSourceMap(
    "% DAETUM_OBJECT_BEGIN id1 freeform-polygon\n% DAETUM OBJECT: P\n% DAETUM ID: id1\n% DAETUM TYPE: freeform-polygon\n\\definecolor{daetumC123456}{RGB}{18,52,86}\n\\draw[draw=daetumC123456] (0,50) -- (40,0) -- (80,50) -- cycle;\n% DAETUM_OBJECT_END id1\n",
  ),
);
c.blocks.forEach((b) =>
  b.statements.forEach((s) =>
    console.log(JSON.stringify(s.text), "| shape:", s.shape && s.shape.type),
  ),
);

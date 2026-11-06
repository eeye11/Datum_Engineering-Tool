const sm = require("../src/shared/rendering/latex/source-model.js");
const dsrc = require("../src/shared/rendering/latex/drawing-source.js");
const src = [
  "\\begin{tikzpicture}[x=1mm, y=1mm]",
  "% DAETUM OBJECT: Freeform Polygon",
  "% DAETUM ID: frame-1",
  "% DAETUM TYPE: freeform-polygon",
  "\\definecolor{daetumC123456}{RGB}{18,52,86}",
  "\\draw[draw=daetumC123456, line width=1.2pt]",
  "  (0,0)",
  "  -- (80,0)",
  "  -- (80,40)",
  "  -- cycle;",
  "\\end{tikzpicture}",
].join("\n");
const c = sm.blockContents(src, dsrc.createSourceMap(src));
c.blocks.forEach((b) => {
  console.log("block", b.id, JSON.stringify(b.body.slice(0, 60)));
  b.statements.forEach((st) =>
    console.log(
      "  STMT",
      JSON.stringify(st.text.slice(0, 60)),
      "shape:",
      st.shape && st.shape.type,
      "stroke:",
      st.shape && st.shape.stroke,
      "lineWidth:",
      st.shape && st.shape.lineWidth,
    ),
  );
});

const s = require("../src/shared/rendering/latex/source-statements.js");
const sm = require("../src/shared/rendering/latex/source-model.js");
const ds = require("../src/shared/rendering/latex/drawing-source.js");
const t =
  "\\begin{tikzpicture}[x=1mm, y=1mm]\n% DAETUM OBJECT: Freeform Polygon\n% DAETUM ID: freeform-polygon-abcd\n% DAETUM TYPE: freeform-polygon\n\\definecolor{daetumC123456}{RGB}{18,52,86}\n\\draw[draw=daetumC123456, line width=1.2pt]\n  (0,0)\n  -- (80,0)\n  -- (80,40)\n  -- (40,40)\n  -- (40,80)\n  -- (0,80)\n  -- cycle;\n\\end{tikzpicture}";
const map = ds.createSourceMap(t);
console.log("BLOCKS", map.blocks.length);
s.splitStatements(t).forEach((x) =>
  console.log("STMT", JSON.stringify(x.name), x.complete, "line", x.startLine),
);
const c = sm.blockContents(t, map);
c.blocks.forEach((b) => {
  console.log("BLOCK", b.id, "body=", JSON.stringify(b.body));
  b.statements.forEach((st) =>
    console.log(
      "  ->",
      JSON.stringify(st.text.slice(0, 40)),
      st.shape && st.shape.type,
    ),
  );
});

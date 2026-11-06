const s = require("../src/shared/rendering/latex/source-statements.js");
const sm = require("../src/shared/rendering/latex/source-model.js");
const text =
  "\\begin{tikzpicture}[x=1mm, y=1mm]\n% DAETUM_OBJECT_BEGIN id1 freeform-polygon\n% DAETUM OBJECT: P\n% DAETUM ID: id1\n% DAETUM TYPE: freeform-polygon\n\\draw[black] (0,0) -- (80,0) -- (80,40) -- (40,40) -- (40,80) -- (0,80) -- cycle;\n% DAETUM_OBJECT_END id1\n\\end{tikzpicture}";
s.splitStatements(text).forEach((st) =>
  console.log(
    JSON.stringify(st.name),
    "complete:",
    st.complete,
    "len:",
    st.end - st.start,
  ),
);

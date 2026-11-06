const s = require("../src/shared/rendering/latex/source-statements.js");
const text =
  "% DAETUM_OBJECT_BEGIN id1 freeform-polygon\n% DAETUM ID: id1\n\\definecolor{daetumC123456}{RGB}{18,52,86}\n\\draw[draw=daetumC123456] (0,50) -- (40,0) -- (80,50) -- cycle;\n% DAETUM_OBJECT_END id1\n";
s.splitStatements(text).forEach((st) =>
  console.log(
    JSON.stringify(st.name),
    JSON.stringify(text.slice(st.start, st.end)),
    "complete:",
    st.complete,
  ),
);

const path = require("path");
const { JSDOM } = require("jsdom");
const { createHarness } = require("./harness-renderer.cjs");
createHarness(path.join(__dirname, ".."), JSDOM, require);
const { loadModule } = require("./helpers/source-path.cjs");

const sync = loadModule("source-object-sync.js");
const model = loadModule("drawing-state.js").default;
const geometry = loadModule("geometry.js");

const line = model.geometryFactories.line(
  { x: -40, y: 0 },
  { x: 40, y: 0 },
  { style: { lineWidth: "thin" } },
);

const objects = [line];
const candidateObjects = objects.map((object) => ({
  id: object.id,
  type: object.type,
  object,
  source: geometry.geometrySourceWriter(object),
  taken: false,
}));

const draft =
  "\\begin{tikzpicture}[x=1mm, y=1mm]\n\\draw[black] (-40,0) -- (40,0);\n\\end{tikzpicture}";

console.log("object geom:", JSON.stringify(line.geometry));
console.log("candidate source:", candidateObjects[0].source);
const adopted = sync.adoptUnclaimedStatements(draft, {
  candidates: candidateObjects,
});
console.log(adopted);
console.log(
  "same id?",
  adopted.includes(line.id),
  "taken:",
  candidateObjects[0].taken,
);

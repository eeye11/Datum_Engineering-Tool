const { bootApp } = require("./tests/helpers/boot-app.cjs");
const { locate } = require("./tests/helpers/source-path.cjs");

bootApp();

const sourceSync = require(locate("source-object-sync.js"));
const drawingSource = require(locate("drawing-source.js"));

const source = [
  "% DAETUM OBJECT: Elbow",
  "% DAETUM ID: elbow-check",
  "% DAETUM TYPE: elbow",
  "\\draw (0,0) -- (100,0);",
  "\\draw (100,0) -- (100,100);",
].join("\n");

const report = sourceSync.readSourceIntoModel({
  source,
  map: drawingSource.createSourceMap(source),
  objects: [
    {
      id: "elbow-check",
      type: "elbow",
      name: "Elbow",
      geometry: {
        position: { x: 100, y: 0 },
        previous: { x: 0, y: 0 },
        next: { x: 100, y: 100 },
      },
      engineering: { bendRadius: 10 },
      style: {},
    },
  ],
  isEditing: () => false,
});

console.log(JSON.stringify(report));

process.exit(0);

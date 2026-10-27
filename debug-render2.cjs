const { bootApp } = require("./tests/helpers/boot-app.cjs");
const { locate } = require("./tests/helpers/source-path.cjs");

bootApp();

const tool = require(locate("pipe-duct-tool.js"));
const sync = require(locate("source-synchronization.js"));
const schema = require(locate("feature-schema.js"));
const state = require(locate("editor-state.js")).drawingState;

state.objects = [];

const { elbow } = tool.commitElbowGesture({ x: 0, y: 0 }, { x: 100, y: 0 });

(async () => {
  const renderer = await import("./server/tikz.js");
  await renderer.loadTikz();

  /* Plain elbow. */
  const plain = await renderer.renderTikz(
    `\\begin{tikzpicture}[x=1mm, y=1mm]\n${sync.sourceForObject(elbow)}\n\\end{tikzpicture}`,
  );

  console.log("=== PLAIN (path/line tags) ===");
  console.log(
    [...plain.matchAll(/<(path|line|polyline|g)\b[^>]*>/g)]
      .map((m) => m[0])
      .join("\n"),
  );

  /* Filled elbow. */
  schema.writeField(elbow, "fillMode", "solid");

  const filled = await renderer.renderTikz(
    `\\begin{tikzpicture}[x=1mm, y=1mm]\n${sync.sourceForObject(elbow)}\n\\end{tikzpicture}`,
  );

  console.log("=== FILLED (path/line tags) ===");
  console.log(
    [...filled.matchAll(/<(path|line|polyline|g)\b[^>]*>/g)]
      .map((m) => m[0])
      .join("\n"),
  );

  process.exit(0);
})();

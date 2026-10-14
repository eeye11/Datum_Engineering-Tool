/*
 * DEFECTS THAT ONLY SHOWED UP WHEN THE CODE RAN.
 *
 * Each of these lived on main because the code that failed called a name
 * that did not exist in its scope. Classic scripts give no warning for that;
 * it fails only when the line runs, and then only as an error in the
 * console. The move to ES modules made ESLint able to see them; these tests
 * keep them from coming back by running the real code in the booted editor.
 *
 *   - Selecting a Triangle: 'finaliseRows is not defined', so its
 *     Features panel never rendered.
 *   - Placing a Distributed Load: 'section is not defined', so the tool
 *     could never create a load.
 *   - Undo/redo across a sheet change: 'renderSheetTabs is not defined'.
 *     The history swallowed the error, so the canvas and the panel were
 *     simply never re-rendered after the sheets were restored.
 *   - Arming an SFD/BMD/AFD tool and clicking off a member: a TypeError in
 *     analysisSourceBody.
 *   - The Varying Distributed Load could not be built: its build phase was
 *     left out when the uniform load's steps were given their own set, so
 *     each click fell through and the tool reset.
 */
const path = require("path");
const { bootApp } = require("./helpers/boot-app.cjs");

let pass = 0;
let fail = 0;

const check = (name, ok, detail) => {
  if (ok) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name}${detail ? `\n       ${detail}` : ""}`);
  }
};

const attempt = (fn) => {
  try {
    return { value: fn(), error: null };
  } catch (error) {
    return { value: undefined, error };
  }
};

const { document, error: bootError } = bootApp();

if (bootError) {
  console.log(`  the application did not boot: ${bootError.message}`);
  process.exit(1);
}

/* By file name, so a module can move between folders without breaking this. */
const { locate } = require("./helpers/source-path.cjs");
const src = (file) => require(locate(path.basename(file)));

const model = src("core/model/drawing-state.js").default;
const { drawingState, editorState } = src("editor/editor-state.js");
const { renderProperties } = src("editor/feature-panel.js");
const { renderLoadBuildPanel } = src("editor/feature-tree.js");
const { analysisSourceBody } = src("editor/analysis-tools.js");

const panel = document.getElementById("drawingProperties");

console.log("\n  a Triangle's Features panel renders\n");

{
  const triangle = model.geometryFactories.triangle(
    [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 0, y: 30 }],
    {},
  );

  model.addObject(drawingState, triangle);
  model.selectObject(drawingState, triangle.id);

  /* As clicking the feature in the tree does: open its properties. */
  editorState.featurePanelView = "edit";

  const result = attempt(() => renderProperties());

  check(
    "rendering it does not throw",
    !result.error,
    result.error && result.error.message,
  );

  check(
    "and the panel shows its sides",
    /Side/i.test(panel.textContent),
    "the triangle panel has no side rows",
  );

  model.clearSelection(drawingState);
}

console.log("\n  the Distributed Load build panel renders\n");

{
  const result = attempt(() => renderLoadBuildPanel({ loadSourceId: null }));

  check(
    "rendering it does not throw",
    !result.error,
    result.error && result.error.message,
  );

  check(
    "and it opens with its heading",
    /DISTRIBUTED LOAD/.test(panel.innerHTML) &&
      panel.querySelector(".drawing-properties-section") !== null,
    "the DISTRIBUTED LOAD heading is missing",
  );

  check(
    "and it states the source body",
    /Source Body/.test(panel.textContent) && /Free span/.test(panel.textContent),
    "the source body row is missing",
  );
}

console.log("\n  restoring sheets from history completes\n");

{
  const sinks = drawingState.historySinks;

  check("the editor installed its history sinks", Boolean(sinks && sinks.capture && sinks.restore));

  /* Called directly: inside Undo the error was swallowed. */
  const result = attempt(() => sinks.restore(sinks.capture()));

  check(
    "the restore sink runs to the end",
    !result.error,
    result.error && result.error.message,
  );
}

console.log("\n  an analysis diagram ignores a click on nothing\n");

{
  const beam = model.geometryFactories.beam({ x: 0, y: 0 }, { x: 50, y: 0 }, {});

  const nothing = attempt(() => analysisSourceBody([undefined]));

  check(
    "a missing candidate is not a body, and does not throw",
    !nothing.error && nothing.value === null,
    nothing.error ? nothing.error.message : `got ${JSON.stringify(nothing.value)}`,
  );

  const mixed = attempt(() => analysisSourceBody([undefined, beam]));

  check(
    "a real member beside it is still found",
    !mixed.error && mixed.value === beam,
    mixed.error && mixed.error.message,
  );
}

console.log("\n  a Varying Distributed Load can be built\n");

{
  const { isLoadBuildPhase } = src("editor/load-tool.js");

  check(
    "its build phase is a load-build phase (clicks add points, Enter finishes)",
    isLoadBuildPhase({ phase: "distributed-load-build" }) === true,
  );

  check(
    "and the uniform load's steps still are",
    ["distributed-load-start", "distributed-load-end", "distributed-load-vector"]
      .every((phase) => isLoadBuildPhase({ phase })),
  );
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);

process.exit(fail ? 1 : 0);

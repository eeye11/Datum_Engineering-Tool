/*
 * ========================================================
 * THE SEARCH REACHES WHAT IS ALREADY DRAWN
 * ========================================================
 *
 * "Change pipe width" is not a request for a tool to draw another pipe. It is a
 * request for the Width row of the pipe that is on the sheet - and a student
 * should not have to select it on the canvas first to find it.
 *
 * So this boots the real page, DRAWS a pipe with the Pipe / Duct model the
 * application uses, and then searches:
 *
 *   the pipe itself is findable by name, and by what it is
 *   its Width setting is findable by "pipe width", with no selection
 *   activating it selects the pipe and opens its Features panel
 *   and the width field the panel renders is the one that is focused
 *
 * It also checks the other side of the rule: a feature DELETED from the sheet
 * stops being offered, so the list cannot go stale within a session.
 */
const { runInFreshPage } = require("./helpers/boot-app.cjs");

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

console.log("\n  a drawn pipe and its width are searchable WITHOUT selecting it\n");

const report = runInFreshPage(String.raw`async ({ projectRoot, require, bootError }) => {
  if (bootError) {
    return { bootError: String(bootError && bootError.stack || bootError) };
  }

  const { drawingState } = require(projectRoot + "/src/features/workspace/editor-state.js");
  const model = require(projectRoot + "/src/shared/model/drawing-state.js").default;
  const search = require(projectRoot + "/src/components/layout/toolbar/command-search.js");
  const index = require(projectRoot + "/src/components/layout/toolbar/command-index.js");
  const ducts = require(projectRoot + "/src/features/workspace/model/fluids/pipe-duct.js");

  const out = {};

  /* Draw a pipe, the way the tool commits one. */
  const pipe = ducts.createPipeDuct
    ? ducts.createPipeDuct(
        { x: 0, y: 0 },
        { x: 120, y: 0 },
        { style: { ...drawingState.styleDefaults } },
      )
    : model.geometryFactories.line(
        { x: 0, y: 0 },
        { x: 120, y: 0 },
        { style: { ...drawingState.styleDefaults }, engineering: { discipline: "fluids" } },
      );

  model.addObject(drawingState, pipe);
  model.clearSelection?.(drawingState);

  out.selectionBefore = (drawingState.selection.selectedObjectIds || []).length;

  const rows = index.searchIndex().filter((entry) => entry.type === "feature");

  out.featureRows = rows.filter((entry) => entry.kind !== "setting").map((entry) => entry.label);
  out.settingLabels = rows.filter((entry) => entry.kind === "setting").map((entry) => entry.label);

  const width = search
    .searchCommands("change pipe width", 20)
    .find((entry) => entry.type === "feature" && /width/i.test(entry.label));

  out.widthFound = Boolean(width);
  out.widthLabel = width?.label || null;
  out.widthLocal = width?.location || null;

  /* The tool is still offered first - the search does not hide it. */
  out.toolFirst = search.searchCommands("pipe", 5).map((entry) => entry.type);

  if (width) {
    await width.run();
    await new Promise((resolve) => setTimeout(resolve, 40));
  }

  out.selectionAfter = drawingState.selection.selectedObjectIds || [];
  out.tab = document.querySelector(".drawing-panel-tab.active")?.dataset.panelTab || null;
  /* The pipe's width is the Transform box - the control the pane really offers. */
  out.focusedField =
    document.activeElement?.dataset?.featureField
    || document.activeElement?.dataset?.transformInput
    || null;
  out.widthFieldRendered = Boolean(
    document.querySelector('[data-transform-input="width"]') ||
      document.querySelector('[data-feature-field="width"]'),
  );

  /* Delete it: the rows must go with it. */
  model.deleteObject?.(drawingState, pipe.id);
  drawingState.objects = drawingState.objects.filter((object) => object.id !== pipe.id);

  out.rowsAfterDelete = index
    .searchIndex()
    .filter((entry) => entry.type === "feature" && entry.objectId === pipe.id).length;

  out.queryAfterDelete = search.searchCommands("change pipe width", 20)
    .filter((entry) => entry.type === "feature").length;

  return out;
}`);

if (report.taskError) {
  console.log(`  task error: ${report.taskError}`);
}

check("the page booted", !report.bootError, report.bootError || "");

check(
  "the pipe is a feature the search can offer",
  (report.featureRows || []).some((label) => /pipe/i.test(label)),
  (report.featureRows || []).slice(0, 6).join(" | "),
);

check(
  "and its settings are offered under the panel's own names",
  (report.settingLabels || []).length > 0,
  (report.settingLabels || []).slice(0, 6).join(" | "),
);

check(
  "\"change pipe width\" finds the pipe's own width setting, with nothing selected",
  report.widthFound === true && report.selectionBefore === 0,
  `found=${report.widthFound}, selected=${report.selectionBefore}`,
);

check(
  "and the result is named for the feature AND the setting",
  /pipe/i.test(report.widthLabel || "") && /width/i.test(report.widthLabel || ""),
  report.widthLabel,
);

check(
  "and it says where the feature is, not that it is a tool",
  /On the sheet/.test(report.widthLocal || ""),
  report.widthLocal,
);

check(
  "the Pipe / Duct TOOL is still offered first for \"pipe\"",
  (report.toolFirst || [])[0] === "tool",
  (report.toolFirst || []).join(", "),
);

check(
  "activating the setting selects the pipe",
  (report.selectionAfter || []).length === 1,
  (report.selectionAfter || []).join(", "),
);

check(
  "and opens the Features panel",
  report.tab === "features",
  report.tab,
);

check(
  "with the width control rendered and focused, ready to type",
  report.widthFieldRendered === true && report.focusedField === "width",
  `rendered=${report.widthFieldRendered}, focused=${report.focusedField}`,
);

check(
  "and a deleted feature stops being offered",
  report.rowsAfterDelete === 0 && report.queryAfterDelete === 0,
  `${report.rowsAfterDelete} rows / ${report.queryAfterDelete} results`,
);

console.log(`\n  ${pass} passed, ${fail} failed\n`);

if (fail) {
  process.exitCode = 1;
}

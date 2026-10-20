/*
 * ========================================================
 * OBJECTS, FEATURES AND SOURCE - ONE SELECTION, ONE SOURCE
 * ========================================================
 *
 * These check the behaviours that tie the three tabs together:
 *
 *   - selecting an object (canvas or Objects list) opens Features;
 *   - double-clicking an already-selected object opens Features and creates
 *     no new selection of its own;
 *   - Features is completely empty with nothing selected;
 *   - Objects highlights every selected row, and a shift-click extends the
 *     selection instead of replacing it;
 *   - selecting an object selects and highlights its SOURCE region, by
 *     identity;
 *   - deleting an object deletes its source region, and only its region;
 *   - every committed drawing edit rewrites that object's source in place,
 *     and leaves the other objects' source untouched;
 *   - a source edit still renders the drawing, and an invalid draft is kept
 *     rather than replaced.
 *
 * The application is booted from the real page, so what is tested is what
 * ships.
 */
const path = require("path");
const { bootApp, whenReady } = require("./helpers/boot-app.cjs");

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

const { window, document, error } = bootApp();

if (error) {
  console.log(`  the application did not boot: ${error.message}`);
  process.exit(1);
}

(async () => {
  await whenReady();

  const { locate } = require("./helpers/source-path.cjs");
  const src = (file) => require(locate(path.basename(file)));

  const model = src("src/shared/model/drawing-state.js").default;
  const { drawingState } = src("features/workspace/editor-state.js");
  const tabs = src("src/components/layout/panels/panel-tabs.js");
  const { renderFeatures } = src("src/components/layout/panels/features-pane.js");
  const { renderObjects } = src("src/components/layout/panels/objects-pane.js");
  const { activeSourceManager } = src("drawing-source-manager.js");
  const mapping = src("source-mapping.js");
  const { deleteSelectedObjects } = src("delete-command.js");

  const featuresBody = document.getElementById("drawingFeatures");
  const objectsHost = document.getElementById("drawingObjects");
  const sourceEditor = document.getElementById("drawingSourceEditor");
  const canvas = document.querySelector(".drawing-canvas");

  const manager = activeSourceManager();

  const add = (object) => {
    const before = model.snapshotDrawing(drawingState);
    const stored = model.addObject(drawingState, object);
    model.commitDrawingChange(drawingState, before);

    return stored;
  };

  const rowFor = (id) =>
    [...objectsHost.querySelectorAll("[data-object-id]")].find(
      (row) => row.dataset.objectId === id,
    );

  const click = (element, init = {}) =>
    element.dispatchEvent(new window.MouseEvent("click", { bubbles: true, ...init }));

  /*
   * A CANVAS DOUBLE-CLICK AT THE OBJECT'S OWN SCREEN POSITION. The canvas handler
   * asks the real hit test what is under the pointer, so the event has to land
   * somewhere a real click would. `getBoundingClientRect` is zero in jsdom, so
   * the point the hit test is given must be the object's own canvas point.
   */
  const doubleClickAt = (point) => {
    const scale = 2.4 * (drawingState.camera.zoom || 1);
    const event = new window.MouseEvent("dblclick", {
      bubbles: true,
      detail: 2,
      clientX: (point.x - drawingState.camera.panX) * scale,
      clientY: -(point.y - drawingState.camera.panY) * scale,
    });

    canvas.dispatchEvent(event);
  };

  /* ======================================================== selection opens Features */

  console.log("\nSelecting an object opens Features");
  console.log("----------------------------------");

  tabs.setActivePanelTab("objects");

  const line = add(
    model.geometryFactories.line({ x: -40, y: 0 }, { x: 40, y: 0 }, {
      style: { stroke: "#112233", lineWidth: 0.5, lineType: "solid" },
    }),
  );
  const circle = add(
    model.geometryFactories.circle({ x: 200, y: 120 }, 30, {
      style: { stroke: "#445566", lineWidth: 0.75 },
    }),
  );

  model.clearSelection(drawingState);
  renderFeatures();
  renderObjects();

  check("Features is completely empty before anything is selected", featuresBody.innerHTML === "", featuresBody.innerHTML.slice(0, 80));

  model.selectObject(drawingState, line.id);

  check("a selection switches the panel to Features", tabs.activePanelTab() === "features", tabs.activePanelTab());
  check(
    "and Features shows the selected object",
    featuresBody.querySelector(".dfp-header-name")?.textContent === line.name,
    featuresBody.querySelector(".dfp-header-name")?.textContent,
  );
  check("and the object's model is the one being edited", Boolean(featuresBody.querySelector('[data-feature-field="lineType"]')));

  /* Selecting through the Objects list is the same selection. */
  tabs.setActivePanelTab("objects");
  renderObjects();
  click(rowFor(circle.id));

  check("clicking a row selects that object", drawingState.selection.selectedObjectIds.join() === circle.id);
  check("and opens Features", tabs.activePanelTab() === "features", tabs.activePanelTab());

  /* ======================================================== multi-selection */

  console.log("\nA deliberate multi-selection is preserved");
  console.log("------------------------------------------");

  tabs.setActivePanelTab("features");

  model.selectObject(drawingState, line.id);
  tabs.setActivePanelTab("objects");
  renderObjects();
  click(rowFor(circle.id), { shiftKey: true });

  check(
    "shift-clicking a row extends the selection",
    drawingState.selection.selectedObjectIds.length === 2 &&
      drawingState.selection.selectedObjectIds.includes(line.id) &&
      drawingState.selection.selectedObjectIds.includes(circle.id),
    drawingState.selection.selectedObjectIds.join(),
  );

  renderObjects();
  check(
    "and both rows are highlighted",
    [line.id, circle.id].every((id) => rowFor(id)?.getAttribute("aria-selected") === "true"),
  );

  renderFeatures();
  check(
    "and Features describes the whole selection",
    featuresBody.querySelector(".dfp-header-name")?.textContent === "2 objects",
    featuresBody.querySelector(".dfp-header-name")?.textContent,
  );

  /* ======================================================== double-click */

  console.log("\nDouble-clicking an already-selected object opens Features");
  console.log("----------------------------------------------------------");

  tabs.setActivePanelTab("objects");

  const centre = { x: 0, y: 0 };

  doubleClickAt(centre);

  check("the tab follows the gesture", tabs.activePanelTab() === "features", tabs.activePanelTab());
  check(
    "and the selection is unchanged - it is not a second selection mechanism",
    drawingState.selection.selectedObjectIds.length === 2,
    drawingState.selection.selectedObjectIds.join(),
  );

  /* ======================================================== source mapping */

  console.log("\nSelection maps to source by identity");
  console.log("-------------------------------------");

  const source = manager.getSource();
  const visibleLines = manager.getVisibleSource().split("\n");
  const lineBlock = mapping.regionForObject(source, line.id);
  const circleBlock = mapping.regionForObject(source, circle.id);

  check("every object has a source region", Boolean(lineBlock && circleBlock));
  check("the regions are its own, and do not touch", lineBlock && circleBlock && lineBlock.endLine < circleBlock.beginLine);
  check(
    "and a region is found by the object's identity, not by its name",
    mapping.objectIdAtLine(source, lineBlock.bodyStartLine) === line.id,
    String(mapping.objectIdAtLine(source, lineBlock.bodyStartLine)),
  );

  tabs.setActivePanelTab("source");

  /*
   * THE EDITOR IS BUILT WHEN THE TAB OPENS. Opening Source through the shared
   * tab controller is what a student does, so it is what the test does - a tab
   * that is merely "active" without its announcement has no editor yet.
   */
  document.dispatchEvent(new window.CustomEvent("datum:panel-tab-changed", { detail: { tab: "source" } }));

  const highlightedLines = () => sourceEditor.querySelectorAll(".drawing-source-line.selected").length;

  check("Source highlights the selected regions", highlightedLines() > 0, String(highlightedLines()));

  model.selectObject(drawingState, circle.id);

  const allRows = [...sourceEditor.querySelectorAll(".drawing-source-line")];
  const highlightedAfter = allRows
    .map((element, index) => (element.classList.contains("selected") ? index + 1 : null))
    .filter((row) => row !== null);

  /*
   * The visible editor has no marker lines, so an object's rows are its
   * commands - the block's own lines less the two marker comments above and
   * below them.
   */
  const circleCommand = source.split("\n")[circleBlock.bodyStartLine];
  const circleRow = visibleLines.indexOf(circleCommand) + 1;

  check(
    "and after selecting another, only the new object's rows are highlighted",
    highlightedAfter.length > 0 && highlightedAfter.length < allRows.length,
    `${highlightedAfter.length} / ${allRows.length}`,
  );
  check(
    "including the circle's own command line",
    circleRow > 0 && highlightedAfter.includes(circleRow),
    `circleRow ${circleRow}, highlighted ${highlightedAfter.join(",")}`,
  );

  model.clearSelection(drawingState);

  check("deselecting all objects clears the source highlight", highlightedLines() === 0, String(highlightedLines()));
  check("without deleting the source text", manager.getSource().includes(line.id) && manager.getSource().includes(circle.id));

  /* ======================================================== edits update source */

  console.log("\nA drawing edit rewrites only that object's source");
  console.log("--------------------------------------------------");

  const circleBefore = manager.getSource();

  model.selectObject(drawingState, line.id);
  line.style.stroke = "#AA3300";
  model.commitDrawingChange(drawingState, model.snapshotDrawing(drawingState));

  const circleAfter = manager.getSource();

  check("the edited object's source changed", circleAfter !== circleBefore);
  const editedBlock = mapping.regionForObject(circleAfter, line.id);
  const editedRegion = editedBlock
    ? circleAfter.split("\n").slice(editedBlock.beginLine, editedBlock.endLine + 1).join("\n")
    : "";

  check("the edit is visible in the edited object's own region", /AA3300/i.test(editedRegion), editedRegion);
  check(
    "and the other object's source is untouched, byte for byte",
    circleBefore.split("\n").slice(circleBlock.beginLine, circleBlock.endLine + 1).join("\n") ===
      circleAfter.split("\n").slice(mapping.regionForObject(circleAfter, circle.id).beginLine, mapping.regionForObject(circleAfter, circle.id).endLine + 1).join("\n"),
  );

  /* ======================================================== deletion */

  console.log("\nDeleting an object deletes its source, and only its source");
  console.log("-----------------------------------------------------------");

  const third = add(model.geometryFactories.point({ x: 60, y: 60 }, {}));

  model.selectObjects(drawingState, [circle.id, third.id]);
  deleteSelectedObjects();

  const afterDelete = manager.getSource();

  check("the deleted objects are gone from the model", !drawingState.objects.some((object) => object.id === circle.id || object.id === third.id));
  check(
    "their source regions are gone",
    mapping.regionForObject(afterDelete, circle.id) === null && mapping.regionForObject(afterDelete, third.id) === null,
  );
  check("the surviving object still has its region", mapping.regionForObject(afterDelete, line.id) !== null);
  check("and the survivor's code is untouched", /AA3300/i.test(afterDelete));
  check("Features is cleared with the selection", drawingState.selection.selectedObjectIds.length === 0);
  check(
    "no orphaned commands recreate the deleted objects",
    !afterDelete.includes(circle.id) && !afterDelete.includes(third.id),
  );

  renderFeatures();
  check("and the Features pane is empty", featuresBody.innerHTML === "", featuresBody.innerHTML.slice(0, 80));

  /* ======================================================== source edits */

  console.log("\nSource stays editable");
  console.log("---------------------");

  tabs.setActivePanelTab("source");

  const textarea = sourceEditor.querySelector("textarea");

  check("the source editor is present", Boolean(textarea));

  const draft = "\\begin{tikzpicture}[x=1mm, y=1mm]\n\\draw[black] (0,0) -- (10,0);\n\\end{tikzpicture}";

  textarea.value = draft;
  textarea.dispatchEvent(new window.Event("input", { bubbles: true }));

  check("typing reaches the document's source", manager.getSource().includes("(0,0) -- (10,0)"));

  /*
   * THE MODEL AS THE DRAFT LEAVES IT.
   *
   * A typed, complete command for a shape the drawing does not hold is ADOPTED -
   * that is the point of the source round trip: hand-typed TikZ becomes editable.
   * The number of objects is therefore recorded HERE, after that adoption, so the
   * next assertion can prove that an INCOMPLETE draft changes nothing further.
   */
  const objectsAfterDraft = drawingState.objects.length;

  const broken = "\\begin{tikzpicture}\n\\draw (0,0 -- (10,0);";

  textarea.value = broken;
  textarea.dispatchEvent(new window.Event("input", { bubbles: true }));

  check(
    "an invalid draft is kept, not silently replaced",
    manager.getSource().includes("\\draw (0,0 -- (10,0);"),
    manager.getSource().slice(0, 80),
  );

  check(
    "and an unfinished command adds nothing to the model",
    drawingState.objects.length === objectsAfterDraft,
    `${drawingState.objects.length} vs ${objectsAfterDraft}`,
  );

  /* ======================================================== no loops, no duplicates */

  console.log("\nA source edit does not regenerate the source, and nothing is duplicated");
  console.log("-------------------------------------------------------------------------");

  const backToLine = "\\begin{tikzpicture}[x=1mm, y=1mm]\n\\draw[black] (-40,0) -- (40,0);\n\\end{tikzpicture}";

  textarea.value = backToLine;
  textarea.dispatchEvent(new window.Event("input", { bubbles: true }));

  const typed = manager.getSource();

  /*
   * WAIT LONG ENOUGH FOR THE TAB'S RENDER DEBOUNCE. If a successful render
   * rewrote the source, the text the student typed would come back changed.
   */
  await new Promise((resolve) => setTimeout(resolve, 800));

  check("the typed source is not overwritten by a render", manager.getSource() === typed, manager.getSource().slice(0, 100));

  const surviving = drawingState.objects[0];

  const countOf = (haystack, needle) => haystack.split(needle).length - 1;

  /*
   * A DRAWING EDIT AFTER A HAND EDIT. The survivor's region is updated in
   * place: the markers are not duplicated, and no second region is appended.
   */
  surviving.style.stroke = "#22AA44";
  model.commitDrawingChange(drawingState, model.snapshotDrawing(drawingState));

  const afterEdit = manager.getSource();

  check(
    "one object still has exactly one source region",
    countOf(afterEdit, `DAETUM_OBJECT_BEGIN id="${surviving.id}"`) === 1 &&
      countOf(afterEdit, `DAETUM_OBJECT_END id="${surviving.id}"`) === 1,
    afterEdit,
  );
  check(
    "and the object model was not changed by the source round trip",
    drawingState.objects.length === objectsAfterDraft,
    `${drawingState.objects.length} vs ${objectsAfterDraft}`,
  );
  check("the drawing edit reached the source", /22AA44/i.test(afterEdit));

  /* ======================================================== undo */

  console.log("\nUndo brings back a deleted object AND its code");
  console.log("-------------------------------------------------");

  model.selectObject(drawingState, surviving.id);
  deleteSelectedObjects();

  check("the deleted object's region is gone", mapping.regionForObject(manager.getSource(), surviving.id) === null);

  model.undo(drawingState);

  check("...and Undo brings the object back", drawingState.objects.some((object) => object.id === surviving.id));
  check(
    "...with its source",
    mapping.regionForObject(manager.getSource(), surviving.id) !== null,
    manager.getSource(),
  );

  /* ======================================================== the picture */

  console.log("\nThe canvas shows the model after a drawing change");
  console.log("---------------------------------------------------");

  const { showRenderedSource } = src("source-canvas-bridge.js");
  const { renderCurrentDrawing } = src("src/components/layout/workspace/canvas-render.js");

  const stale = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  const staleLine = document.createElementNS("http://www.w3.org/2000/svg", "line");

  staleLine.setAttribute("data-stale-source-picture", "true");
  stale.append(staleLine);

  /* A drawing exists first, so the base layer is not the source's. */
  renderCurrentDrawing();
  showRenderedSource(stale, { source: "rendered" });

  check("a rendered source covers the drawing while it is the current picture", Boolean(document.querySelector(".drawing-source-layer:not([hidden])")));

  model.selectObject(drawingState, surviving.id);
  surviving.style.stroke = "#123456";
  model.commitDrawingChange(drawingState, model.snapshotDrawing(drawingState));

  /*
   * THE STALE PICTURE MUST NOT SURVIVE THE EDIT.
   *
   * The Drawing Space now always shows the compiled source, so there is no
   * second layer to hide - the picture layer IS the drawing. What must still
   * hold is the OLD rule's intent: a drawing change never leaves a picture of
   * the previous source on screen. The edited object is drawn by the new
   * source once it compiles, and the marker the test planted must be gone
   * immediately, not merely covered.
   */
  check(
    "so the student sees the object they just edited",
    !document.querySelector("[data-stale-source-picture]"),
    String(document.querySelectorAll("[data-stale-source-picture]").length),
  );
  check(
    "and the source picture layer is the current one",
    Boolean(document.querySelector(".drawing-source-layer")),
  );

  console.log(`\n${pass} passed, ${fail} failed`);

  if (fail > 0) {
    process.exitCode = 1;
  }

  window.close();

  /*
   * THE RENDER SCHEDULER KEEPS A TIMER ALIVE, and `window.close()` does not
   * stop it - `setTimeout` here is Node's, not jsdom's. Left alone the process
   * finishes its assertions and then waits forever, which reads as a hang in
   * CI. Exiting explicitly is honest: every check above has already run.
   */
  process.exit(fail > 0 ? 1 : 0);
})();

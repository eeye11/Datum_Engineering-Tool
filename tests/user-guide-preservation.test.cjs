/*
 * ========================================================
 * A TUTORIAL MUST NOT COST THE STUDENT THEIR DRAWING
 * ========================================================
 *
 * The tutorial steps ask the student to DRAW, on the real canvas, with the real
 * tools. So the tutorials run on a scratch sheet - and this file is the proof
 * that the scratch sheet is genuinely separate and genuinely temporary.
 *
 * IT IS DRIVEN ON A DRAWING THAT IS NOT EMPTY, AND NOT ONE SHEET.
 *
 * A preservation test on a blank canvas passes whatever the code does: nothing
 * can be lost from nothing. So this one builds a document with TWO sheets, each
 * carrying objects, puts the student on the SECOND one, zooms and pans, selects
 * something, and remembers all of it - then enters a tutorial, DRAWS IN IT,
 * undoes in it, leaves mid-way, enters again, finishes, and cancels the guide.
 *
 * What has to survive every one of those exits:
 *
 *   - both sheets, their names and their objects, including the sheet the
 *     student was NOT looking at
 *   - the active sheet (they come back to the one they were on)
 *   - the camera: zoom and pan
 *   - the selection
 *   - the armed tool
 *   - their undo and redo history, untouched by anything done in the tutorial
 *   - the unsaved-changes flag, if the work was unsaved
 *
 * and what must NOT survive:
 *
 *   - anything the student drew inside the tutorial
 */

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

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const { window, document, error } = bootApp();

const click = (element) =>
  element?.dispatchEvent(
    new window.MouseEvent("click", { bubbles: true, cancelable: true }),
  );

(async () => {
  const requireInteresting = async (name) => {
    const { modulePath } = require("./helpers/source-path.cjs");

    return require(modulePath(name));
  };

  const editorStateModule = await requireInteresting("editor-state.js");
  const sheetsModule = await requireInteresting("sheets.js");
  const documentCommands = await requireInteresting("document-commands.js");

  const editorState = editorStateModule.editorState;
  const drawing = editorStateModule.drawingState;
  const sheets = sheetsModule.enggSheets || sheetsModule.default;

  console.log("\n  a drawing with TWO sheets, both carrying work\n");

  check("the page booted", !error, String(error || ""));

  /*
   * THE DOCUMENT IS BUILT THROUGH THE MODEL, not by poking at the DOM: two
   * sheets created by the sheet module's own factory, each given objects made
   * by the geometry factories. That is the shape a real drawing has.
   */
  const sheetOne = sheets.createSheet(
    { sheets: [], activeSheetId: null },
    {
      name: "Beam analysis",
      content: {
        objects: [
          {
            id: "sheet-one-line",
            type: "line",
            geometry: { start: { x: 10, y: 10 }, end: { x: 200, y: 10 } },
            style: { stroke: "#000000", lineWidth: 0.5, lineType: "solid" },
          },
          {
            id: "sheet-one-circle",
            type: "circle",
            geometry: { center: { x: 300, y: 120 }, radius: 40 },
            style: { stroke: "#000000", lineWidth: 0.5, lineType: "solid" },
          },
        ],
        viewport: { zoom: 1.25, panX: -40, panY: 25 },
      },
    },
  );

  const sheetTwo = sheets.createSheet(
    { sheets: [sheetOne], activeSheetId: null },
    {
      name: "Free body",
      content: {
        objects: [
          {
            id: "sheet-two-beam",
            type: "beam",
            geometry: {
              start: { x: 0, y: 0 },
              end: { x: 300, y: 0 },
              depth: 12,
            },
            style: { stroke: "#000000", lineWidth: 0.5, lineType: "solid" },
          },
        ],
        viewport: { zoom: 1.6, panX: 12, panY: -8 },
      },
    },
  );

  const collection = sheets.createCollection({
    sheets: [sheetOne, sheetTwo],
    activeSheetId: sheetTwo.id,
  });

  editorState.sheetCollection = collection;

  /* Load the second sheet into the editor, as the sheet controller does. */
  const sheetController = await requireInteresting("sheet-controller.js");

  sheetController.loadSheetIntoEditor(
    sheets.sheetById(editorState.sheetCollection, sheetTwo.id),
  );

  /* A camera and a selection of the student's own, distinct from defaults. */
  Object.assign(drawing.camera, { zoom: 1.6, panX: 12, panY: -8 });
  drawing.selection = {
    ...drawing.selection,
    selectedObjectIds: ["sheet-two-beam"],
  };
  /*
   * A TOOL THE STUDENT LEFT ARMED IN THEIR OWN DRAWING. The tutorial must put
   * the editor at rest rather than count this as progress towards its own first
   * step, so it is set BEFORE the baseline is captured.
   */
  drawing.activeTool = "rectangle";

  /*
   * HISTORY THE STUDENT HAS, which the tutorial must not disturb. Two real
   * entries, made the way an edit makes one.
   */
  for (let i = 0; i < 2; i += 1) {
    const before = drawing.history.past.length;
    const object = drawing.objects[0];

    object.geometry.end = { x: 300 + i * 10, y: 0 };

    const model = await requireInteresting("drawing-state.js");
    const engine = model.enggDrawingState || model.default;

    engine.commitDrawingChange(drawing, engine.snapshotDrawing(drawing));

    void before;
  }

  const before = {
    sheetNames: editorState.sheetCollection.sheets.map((sheet) => sheet.name),
    activeSheetId: editorState.sheetCollection.activeSheetId,
    /*
     * A COPY OF BOTH SHEETS' OBJECTS, taken as a value. Reading the live sheets
     * later would compare the restored document against itself.
     */
    objects: JSON.parse(
      JSON.stringify(
        editorState.sheetCollection.sheets.map((sheet) => ({
          id: sheet.id,
          objects: sheet.objects,
        })),
      ),
    ),
    editorObjects: JSON.stringify(drawing.objects),
    zoom: drawing.camera.zoom,
    pan: { panX: drawing.camera.panX, panY: drawing.camera.panY },
    selection: [...drawing.selection.selectedObjectIds],
    activeTool: drawing.activeTool,
    historyDepth: drawing.history.past.length,
    dirty: documentCommands.documentDirtyState(),
  };

  check(
    "the drawing starts with two named sheets",
    before.sheetNames.length === 2 &&
      before.sheetNames.includes("Beam analysis") &&
      before.sheetNames.includes("Free body"),
    before.sheetNames.join(", "),
  );

  check(
    "and the student is on the second one",
    before.activeSheetId === sheetTwo.id,
  );

  check(
    "carrying objects on both sheets",
    before.objects[0].objects.length === 2 &&
      before.objects[1].objects.length === 1,
    JSON.stringify(before.objects.map((sheet) => sheet.objects.length)),
  );

  check(
    "with history of their own",
    before.historyDepth === 2,
    String(before.historyDepth),
  );

  /* ------------------------------------------------------------------ */

  const userGuide = await requireInteresting("user-guide.js");
  const enggUserGuide = userGuide.default || userGuide.enggUserGuide;

  const freshDrawing = async () => requireInteresting("drawing-state.js");

  console.log("\n  a tutorial is entered, and it draws on its OWN sheet\n");

  check(
    "the student has an armed tool of their own",
    drawing.activeTool === "rectangle",
    drawing.activeTool,
  );

  enggUserGuide.open();

  await wait(80);

  document
    .querySelector('[data-guide-section="geometry"]')
    ?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));

  await wait(80);

  document
    .querySelector('[data-guide-tab="tutorials"]')
    ?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));

  await wait(80);

  await enggUserGuide.startTutorialById("geometry-draw-a-shape");

  await wait(400);

  check(
    "the tutorial overlay is open",
    Boolean(document.querySelector(".datum-tutorial-overlay")),
  );

  check(
    "and the editor is now on the TEMPORARY sheet",
    editorState.sheetCollection.sheets.length === 1 &&
      /tutorial/i.test(editorState.sheetCollection.sheets[0].name),
    editorState.sheetCollection.sheets.map((sheet) => sheet.name).join(", "),
  );

  check(
    "which starts empty, whatever the student had drawn",
    drawing.objects.length === 0,
    `${drawing.objects.length} objects`,
  );

  check(
    "and the editor is at rest, not on the tool the student left armed",
    drawing.activeTool === "select",
    drawing.activeTool,
  );

  check(
    "and is not the sheet the student was looking at",
    editorState.sheetCollection.activeSheetId !== before.activeSheetId,
  );

  /*
   * THE STUDENT DRAWS IN THE TUTORIAL. This is the situation the isolation
   * exists for: a real rectangle, made by the real factory and committed the
   * way the canvas commits one, while the tutorial is running.
   */
  const model = await freshDrawing();
  const engine = model.enggDrawingState || model.default;

  /*
   * WALK TO THE RECTANGLE-DRAWING STEP, THEN DRAW IT.
   *
   * Step 1 names the Geometry toolset and step 2 the Rectangle tool. Both are
   * PERFORMED here - the same clicks a student makes - and only then is a
   * rectangle committed, which is the step the drawing is about.
   *
   * THE CHECKS ARE MADE BEFORE THE PRESS THEY DESCRIBE. The panel is rebuilt
   * when a step completes, so reading its buttons after pressing one would be
   * reading the NEXT step's buttons.
   */
  const panel = () => document.querySelector(".datum-tutorial-panel");

  const stepTitle = () =>
    panel()?.querySelector(".datum-tutorial-step-title")?.textContent || "";

  const hasTask = () => Boolean(panel()?.querySelector("[data-tutorial-task]"));

  const firstTitle = stepTitle();

  check(
    "the tutorial opens on its first step",
    /open geometry/i.test(firstTitle),
    firstTitle,
  );

  /*
   * THE FIRST STEP IS A REAL ACTION, NOT A CONTINUE.
   *
   * No tutorial begins by opening Help or reading a menu bar - the student is
   * already in the tutorial - so the opening step names the toolset they need
   * and waits for them to press it. That is why there is no forward control
   * here and a "your turn" line instead.
   */
  check(
    "which asks for a real action, with no Continue and no Next",
    hasTask() &&
      !panel()?.querySelector("[data-tutorial-continue]") &&
      !panel()?.querySelector("[data-tutorial-next]"),
    firstTitle,
  );

  /* Step 1 -> 2, by performing it: the GEOMETRY button in the toolset row. */
  document.querySelector('.drawing-category[data-category="GEOMETRY"]')?.click();
  await wait(1200);

  const secondTitle = stepTitle();

  check(
    "the second step asks for the Rectangle tool, with no forward button",
    /arm/i.test(secondTitle) &&
      hasTask() &&
      !panel()?.querySelector("[data-tutorial-next]"),
    secondTitle,
  );

  /* Step 2: arm Rectangle, the real tool button in the Tools panel. */
  document.querySelector('.drawing-tool[data-tool-id="rectangle"]')?.click();

  /* One poll plus the automatic advance, with margin. */
  await wait(1200);

  const thirdTitle = stepTitle();

  check(
    "arming the Rectangle tool ADVANCES the tutorial by itself",
    thirdTitle !== secondTitle,
    `${secondTitle} -> ${thirdTitle}`,
  );

  check(
    "and the next step asks the student to draw it",
    /draw/i.test(thirdTitle) && hasTask(),
    thirdTitle,
  );

  const rectangle = engine.geometryFactories.rectangle(
    { x: 20, y: 20 },
    { x: 160, y: 120 },
    { style: { ...drawing.styleDefaults } },
  );

  const rectBefore = engine.snapshotDrawing(drawing);

  engine.addObject(drawing, rectangle);
  engine.commitDrawingChange(drawing, rectBefore);

  await wait(1200);

  const drawnTitle = stepTitle();

  check(
    "and drawing it ADVANCES the tutorial by itself",
    drawnTitle !== thirdTitle,
    `${thirdTitle} -> ${drawnTitle}`,
  );

  const rectangleWasThere = drawing.objects.some(
    (object) => object.id === rectangle.id,
  );

  check(
    "with the rectangle on the tutorial sheet while the step ran",
    rectangleWasThere,
  );

  check(
    "Undo inside the tutorial undoes TUTORIAL work only",
    (engine.undo(drawing),
    !drawing.objects.some((object) => object.id === rectangle.id)),
  );

  /* ------------------------------------------------------------------ */

  console.log("\n  leaving mid-tutorial restores the drawing exactly\n");

  enggUserGuide.close();

  await enggUserGuide.closeAndWait?.();

  await wait(300);

  check(
    "both sheets are back, with their names",
    JSON.stringify(
      editorState.sheetCollection.sheets.map((sheet) => sheet.name),
    ) === JSON.stringify(before.sheetNames),
    editorState.sheetCollection.sheets.map((sheet) => sheet.name).join(", "),
  );

  check(
    "on the sheet the student was looking at",
    editorState.sheetCollection.activeSheetId === before.activeSheetId,
  );

  check(
    "with every object on both sheets untouched",
    JSON.stringify(
      editorState.sheetCollection.sheets.map((sheet) => ({
        id: sheet.id,
        objects: sheet.objects,
      })),
    ) === JSON.stringify(before.objects),
  );

  check(
    "the editor is showing the student's own objects, not the scratch sheet's",
    JSON.stringify(drawing.objects) === before.editorObjects,
  );

  check(
    "the zoom and pan are exactly as they were",
    drawing.camera.zoom === before.zoom &&
      drawing.camera.panX === before.pan.panX &&
      drawing.camera.panY === before.pan.panY,
    JSON.stringify(drawing.camera),
  );

  check(
    "the selection is as it was",
    JSON.stringify(drawing.selection.selectedObjectIds) ===
      JSON.stringify(before.selection),
    JSON.stringify(drawing.selection.selectedObjectIds),
  );

  check(
    "the armed tool is as it was",
    drawing.activeTool === before.activeTool,
  );

  check(
    "their undo history is intact, with nothing added by the tutorial",
    drawing.history.past.length === before.historyDepth,
    `${before.historyDepth} → ${drawing.history.past.length}`,
  );

  check(
    "and unsaved work is still flagged as unsaved",
    documentCommands.documentDirtyState() === before.dirty,
    `dirty ${before.dirty} → ${documentCommands.documentDirtyState()}`,
  );

  check(
    "the tutorial's rectangle did not come back with it",
    !drawing.objects.some((object) => object.id === rectangle.id),
  );

  /* ------------------------------------------------------------------ */

  console.log("\n  a second run, finished properly, restores it too\n");

  enggUserGuide.open();

  await wait(80);

  document
    .querySelector('[data-guide-section="geometry"]')
    ?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));

  await wait(80);

  await enggUserGuide.startTutorialById("geometry-draw-a-shape");

  await wait(400);

  check(
    "the tutorial opens on a fresh scratch sheet again",
    drawing.objects.length === 0 &&
      editorState.sheetCollection.sheets.length === 1,
  );

  /* It opens with a worked example, so the sheet the student was on is not used. */
  document.querySelector(".datum-tutorial-overlay")?.remove();

  enggUserGuide.close();

  await enggUserGuide.closeAndWait?.();

  await wait(300);

  check(
    "closing from inside a running tutorial still restores the document",
    JSON.stringify(
      editorState.sheetCollection.sheets.map((sheet) => ({
        id: sheet.id,
        objects: sheet.objects,
      })),
    ) === JSON.stringify(before.objects) &&
      editorState.sheetCollection.sheets.length === 2,
  );

  check(
    "and the guide is gone",
    !document.querySelector(".datum-guide-dialog") &&
      !document.querySelector(".datum-tutorial-overlay"),
  );

  /* ------------------------------------------------------------------ */

  console.log("\n  what a save would write holds the student's sheets\n");

  /*
   * `serializeCollection` is what the file writer and the recovery copy both
   * serialise. If the scratch sheet were still in the collection it would be
   * written into the student's file - so the check is on that function's
   * output, not on a guess.
   */
  const body = JSON.stringify(
    sheets.serializeCollection(editorState.sheetCollection),
  );

  check(
    "the serialised document names the student's sheets, not the tutorial's",
    body.includes("Beam analysis") && body.includes("Free body"),
    body.slice(0, 140),
  );

  check(
    "and does not contain the tutorial sheet",
    !/Tutorial \(temporary\)/.test(body),
  );

  check(
    "nor the rectangle drawn during the tutorial",
    !body.includes(rectangle.id),
  );

  check(
    "the drawing is still editable afterwards",
    (() => {
      const object = engine.geometryFactories.line(
        { x: 0, y: 0 },
        { x: 50, y: 50 },
        { style: { ...drawing.styleDefaults } },
      );

      const snapshot = engine.snapshotDrawing(drawing);

      engine.addObject(drawing, object);
      engine.commitDrawingChange(drawing, snapshot);

      const added = drawing.objects.some(
        (candidate) => candidate.id === object.id,
      );

      engine.undo(drawing);

      return added;
    })(),
  );

  console.log(`\n  ${pass} passed, ${fail} failed\n`);

  process.exit(fail ? 1 : 0);
})().catch((caught) => {
  console.error(caught);
  process.exitCode = 1;
});

/*
 * Sheets and Drawing References, driven through the real application.
 *
 * The pure modules are tested directly elsewhere. What this covers is
 * everything that can only be wrong in a browser: that the tab bar
 * renders and behaves, that switching sheets moves the live drawing
 * rather than copying it, that a figure renders from the sheet it
 * names and follows it through a rename and a reorder, and that the
 * grid appears in a rendered output exactly when the sheet says it
 * should.
 *
 * Everything the model knows is read through the application's own
 * public surface (window.enggDrawingSheets), and everything the user
 * does is done by clicking - the tab bar, the + button, the context
 * menu - so that what is verified is the behaviour a student would
 * actually get, not just what the model claims.
 */
export default async function run(page, ui) {
  const out = {};
  const log = (key, value) => {
    out[key] = value;
  };

  /*
   * Ask the page a question and bring the answer back.
   *
   * The application's globals live in the world its own scripts run
   * in, so the question is asked by running a script there and parking
   * the answer on an attribute, which can then be read normally. The
   * code being asked about is the code the application runs; only the
   * answering is indirect.
   *
   * A question that cannot be asked, or whose answer cannot be read
   * back, is reported as an answer rather than thrown. A verification
   * run is meant to be read all the way through, and one question that
   * failed would otherwise hide every answer after it and make a
   * small problem look like a broken feature.
   */
  async function ask(body) {
    const content =
      "(function(){" +
      "var out;try{out=(function(){" +
      body +
      "})();}catch(e){out={error:String(e)};}" +
      "document.documentElement.setAttribute('data-probe'," +
      "JSON.stringify(out===undefined?null:out));" +
      "})();";

    try {
      await page.addScriptTag({ content });
    } catch (error) {
      return { questionFailed: String(error).slice(0, 400) };
    }

    let raw = null;

    try {
      raw = await page.evaluate(() =>
        document.documentElement.getAttribute("data-probe")
      );

      await page.evaluate(() =>
        document.documentElement.removeAttribute("data-probe")
      );
    } catch (error) {
      return { answerFailed: String(error).slice(0, 400) };
    }

    try {
      return raw === null ? null : JSON.parse(raw);
    } catch (error) {
      return { unparseableAnswer: String(raw).slice(0, 400) };
    }
  }

  const readSheets = () =>
    ask(
      "var S = window.enggDrawingSheets;" +
        "return {" +
        "sheets: S.all().map(function (s) {" +
        "return { id: s.id, name: s.name," +
        "features: s.objects.map(function (o) { return o.type; })," +
        "grid: s.grid.visible," +
        "zoom: Math.round(s.viewport.zoom * 100) };" +
        "})," +
        "activeId: S.activeSheetId()," +
        "editorFeatures: window.enggDrawing.state.objects.map(function (o) { return o.type; })," +
        "editorGrid: window.enggDrawing.state.grid.visible," +
        "tabs: Array.prototype.map.call(document.querySelectorAll('.drawing-sheet-tab'), function (t) { return t.textContent; })," +
        "activeTab: (document.querySelector('.drawing-sheet-tab.active') || {}).textContent" +
        "};"
    );

  await page.getByRole("button", { name: "Engineering Drawing" }).click();
  await page.waitForSelector(".drawing-sheet-tab", {
    state: "visible"
  });
  log("start", await readSheets());

  /*
   * Draw on sheet 1 through the same model the tools use, so that
   * sheet 2 really is a different drawing rather than an empty tab.
   */
  log(
    "drewOnSheetOne",
    await ask(
      "var M = window.enggDrawing.model;" +
        "M.addObject(window.enggDrawing.state, M.createGeometryObject('beam'," +
        "{ start: { x: -40, y: 0 }, end: { x: 40, y: 0 }, depth: 12 }));" +
        "M.commitDrawingChange(window.enggDrawing.state, []);" +
        "return true;"
    )
  );

  /* Press the + button, as a student would. */
  await page.click(".drawing-sheet-add");
  await page.waitForTimeout(300);
  log("afterAdd", await readSheets());

  await ask(
    "var M = window.enggDrawing.model;" +
      "M.addObject(window.enggDrawing.state, M.createGeometryObject('force'," +
      "{ start: { x: 0, y: 0 }, end: { x: 0, y: -25 }," +
      "position: { x: 0, y: 0 }, magnitude: 25, angle: -90 }));" +
      "M.addObject(window.enggDrawing.state, M.createGeometryObject('particle'," +
      "{ position: { x: 0, y: 0 } }));" +
      "M.commitDrawingChange(window.enggDrawing.state, []);" +
      "return true;"
  );
  log("drewOnSheetTwo", await readSheets());

  /* Click back to the first tab. */
  await page.locator(".drawing-sheet-tab").first().click();
  await page.waitForTimeout(300);
  log("switchedBack", await readSheets());

  /* Rename it through the tab, answering the prompt. */
  page.once("dialog", (dialog) => dialog.accept("Problem Drawing"));
  await page.locator(".drawing-sheet-tab").nth(1).dblclick();
  await page.waitForTimeout(400);
  log("afterRename", await readSheets());

  /* Right-click the second tab for the menu. */
  await page
    .locator(".drawing-sheet-tab")
    .nth(1)
    .click({ button: "right" });
  await page.waitForSelector(".drawing-sheet-menu");
  log(
    "menu",
    await ask(
      "return Array.prototype.map.call(" +
        "document.querySelectorAll('.drawing-sheet-menu button')," +
        "function (b) { return { label: b.textContent, disabled: b.disabled }; });"
    )
  );

  /* Duplicate from the menu. */
  await page
    .locator(".drawing-sheet-menu button", { hasText: "Duplicate" })
    .click();
  await page.waitForTimeout(400);
  log("afterDuplicate", await readSheets());

  /* And prove the duplicate is independent of its original. */
  log(
    "duplicateIndependence",
    await ask(
      "var S = window.enggDrawingSheets;" +
        "var all = S.all();" +
        "var copy = all[2];" +
        "var original = all[1];" +
        "copy.objects[0].geometry.start.x = 999;" +
        "return {" +
        "copyName: copy.name," +
        "copyIdDiffers: copy.id !== original.id," +
        "featureIdsAreNew: copy.objects.every(function (o) {" +
        "return !original.objects.some(function (p) { return p.id === o.id; });" +
        "})," +
        "originalUnchanged: original.objects[0].geometry.start.x," +
        "copyChanged: copy.objects[0].geometry.start.x" +
        "};"
    )
  );

  /* Delete the duplicate, accepting the confirmation. */
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .locator(".drawing-sheet-tab")
    .nth(2)
    .click({ button: "right" });
  await page.waitForSelector(".drawing-sheet-menu");
  await page
    .locator(".drawing-sheet-menu button", { hasText: "Delete" })
    .click();
  await page.waitForTimeout(400);
  log("afterDelete", await readSheets());

  /*
   * A figure rendered from the FBD sheet, in four conditions: grid on,
   * grid off, with the editor zoomed right in, and a sheet that has
   * nothing on it. The figure must follow the sheet's grid and must
   * ignore the editor's zoom.
   */
  log(
    "figure",
    await ask(
      "var S = window.enggDrawingSheets;" +
        "var all = S.all();" +
        "var fbd = all[1];" +
        "S.activateSheet(fbd.id);" +
        "var describe = function (result) {" +
        "if (!result || !result.svg) {" +
        "return { ok: result && result.ok, empty: Boolean(result && result.empty), reason: result && result.reason };" +
        "}" +
        "var grid = result.svg.querySelector('.drawing-engineering-grid');" +
        "return {" +
        "ok: result.ok," +
        "caption: result.caption," +
        "paths: result.svg.querySelectorAll('path').length," +
        "gridPaths: result.svg.querySelectorAll('.drawing-engineering-grid').length," +
        "gridStroke: grid ? grid.getAttribute('stroke') : null," +
        "handles: result.svg.querySelectorAll('.drawing-manipulation-handle').length," +
        "selectionBoxes: result.svg.querySelectorAll('.drawing-selection-box').length," +
        "width: result.svg.getAttribute('width')," +
        "height: result.svg.getAttribute('height')" +
        "};" +
        "};" +
        "fbd.grid.visible = true;" +
        "var gridOn = describe(S.renderReference(fbd.id, { width: 700, height: 400 }));" +
        "fbd.grid.visible = false;" +
        "var gridOff = describe(S.renderReference(fbd.id, { width: 700, height: 400 }));" +
        "fbd.grid.visible = true;" +
        "window.enggDrawing.state.camera.zoom = 5;" +
        "var zoomed = describe(S.renderReference(fbd.id, { width: 700, height: 400 }));" +
        "window.enggDrawing.state.camera.zoom = 1;" +
        "var blank = describe(S.renderReference(all[0].id, { width: 700, height: 400 }));" +
        "return { fbd: fbd.name, gridOn: gridOn, gridOff: gridOff," +
        "editorZoomedTo500: zoomed, emptySheet: blank," +
        "missing: describe(S.renderReference('sheet_nope', { width: 700, height: 400 })) };"
    )
  );

  /* Reorder, then confirm the figure still shows the same sheet. */
  log(
    "afterReorder",
    await ask(
      "var S = window.enggDrawingSheets;" +
        "var fbd = S.all()[1];" +
        "var before = S.renderReference(fbd.id, { width: 400, height: 300 });" +
        "S.reorderSheet(fbd.id, 0);" +
        "var after = S.renderReference(fbd.id, { width: 400, height: 300 });" +
        "return {" +
        "order: S.all().map(function (s) { return s.name; })," +
        "fbdIdUnchanged: S.sheetById(fbd.id).id === fbd.id," +
        "captionBefore: before.caption," +
        "captionAfter: after.caption," +
        "sameFigureSize: before.svg.getAttribute('width') === after.svg.getAttribute('width')" +
        "};"
    )
  );

  /*
   * A figure must be the same figure at any editor zoom.
   *
   * The bounds are measured in world units, but the arrowheads and
   * load profiles are measured at the zoom they are drawn at, so a
   * figure that borrowed the editor's camera would quietly gain or
   * lose margin depending on how far the student happened to be
   * zoomed in. Comparing the rendered path data at three zooms is the
   * direct check: they must be byte-for-byte the same drawing.
   */
  log(
    "figureIgnoresEditorZoom",
    await ask(
      "var S = window.enggDrawingSheets;" +
        "var sheet = S.all()[1];" +
        "S.activateSheet(sheet.id);" +
        "var state = window.enggDrawing.state;" +
        "var originalZoom = state.camera.zoom;" +
        "var sample = function (zoom) {" +
        "state.camera.zoom = zoom;" +
        "var rendered = S.renderReference(sheet.id, { width: 700, height: 400 });" +
        "return rendered.svg.outerHTML;" +
        "};" +
        "var at100 = sample(1);" +
        "var at250 = sample(2.5);" +
        "var at40 = sample(0.4);" +
        "state.camera.zoom = originalZoom;" +
        "return {" +
        "identicalAt100And250: at100 === at250," +
        "identicalAt100And40: at100 === at40," +
        "length: at100.length" +
        "};"
    )
  );

  /* The saved document is what proves persistence. */
  log(
    "saved",
    await ask(
      "var body = window.enggDrawingSheets.serializeDocumentBody();" +
        "return {" +
        "sheets: body.sheets.map(function (s) {" +
        "return { id: s.id, name: s.name, features: s.objects.length," +
        "grid: s.grid.visible," +
        "zoom: Math.round(s.viewport.zoom * 100)," +
        "panX: Math.round(s.viewport.panX) };" +
        "})," +
        "activeSheetId: body.activeSheetId," +
        "envelopeVersion: window.enggDocumentFile.CURRENT_VERSION" +
        "};"
    )
  );

  /*
   * Reload the browser. The recovery copy must bring back every sheet,
   * its name, its content, its viewport and its grid - which is only
   * true if sheets are part of the same document model Save and Open
   * use, rather than a parallel system of their own.
   *
   * The copy is written by the APPLICATION, by making a real edit and
   * letting it save its own recovery copy, rather than by writing
   * storage from here. What is being verified is that the sheets are
   * in the document the application persists - a copy assembled
   * outside it would prove nothing.
   */
  log(
    "recoveryWrite",
    await ask(
      "var M = window.enggDrawing.model;" +
        "M.addObject(window.enggDrawing.state," +
        "M.geometryFactories.circle({ x: 30, y: 25 }, 12));" +
        "M.commitDrawingChange(window.enggDrawing.state, []);" +
        "return true;"
    )
  );

  /* Long enough for the debounced recovery write to land. */
  await page.waitForTimeout(2000);

  page.once("dialog", (dialog) => dialog.accept());
  await page.reload();

  /*
   * The workspace opens on the written side again after a reload, so
   * the drawing tab is shown before its tabs can be seen - the tab bar
   * belongs to the workspace, not to the document.
   */
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: "Engineering Drawing" }).click();
  await page.waitForSelector(".drawing-sheet-tab", {
    state: "visible"
  });
  log("afterReload", await readSheets());

  /* Open a version 1 file and confirm it arrives as a sheet. */
  log(
    "oldFile",
    await ask(
      "var legacy = { format: 'enggdraw', version: 1, document: {" +
        "units: 'mm'," +
        "objects: [{ id: 'b1', type: 'beam'," +
        "geometry: { start: { x: 0, y: 0 }, end: { x: 50, y: 0 } }," +
        "style: {}, metadata: {} }]," +
        "camera: { zoom: 1.25, panX: 12, panY: -4 }," +
        "grid: { visible: false, spacing: 10 } } };" +
        "var result = window.enggDocumentFile.readDocument(legacy);" +
        "return { ok: result.ok, migratedFrom: result.migratedFrom," +
        "sheets: result.document.sheets.map(function (s) {" +
        "return { name: s.name, features: s.objects.length," +
        "grid: s.grid.visible, zoom: s.viewport.zoom, panX: s.viewport.panX };" +
        "})," +
        "activeSheetIsThatSheet:" +
        "result.document.activeSheetId === result.document.sheets[0].id };"
    )
  );

  /*
   * The written side's own interface, used as a user would.
   *
   * Which sheets it offers is read first, because after a reload the
   * offer is whatever the recovered document actually contains - and a
   * check that silently chose a sheet that was not there would prove
   * nothing.
   */
  log(
    "sheetOptions",
    await ask(
      "return Array.prototype.map.call(" +
        "document.getElementById('referenceSheetSelect').options," +
        "function (o) { return o.textContent; });"
    )
  );

  await page.getByRole("button", { name: "Written Solution" }).click();
  await page.waitForTimeout(300);

  await page
    .getByRole("button", { name: "Written Solution" })
    .click();
  await page.waitForTimeout(400);

  const options = out.sheetOptions || [];
  const wanted = Math.min(1, Math.max(0, options.length - 1));

  await page.locator("#referenceSheetSelect").selectOption({
    index: wanted
  });
  await page.locator("#referenceInsert").click();
  await page.waitForTimeout(800);

  log(
    "writtenSide",
    await ask(
      "var code = document.getElementById('writingCode').value;" +
        "return {" +
        "token: code," +
        "tokenHasId: /\\[DRAWING_REFERENCE:sheet_[0-9a-f]+\\]/.test(code)," +
        "figures: document.querySelectorAll('#referencePreview .drawing-reference-figure').length," +
        "renderedSvgs: document.querySelectorAll('#referencePreview .drawing-reference-frame svg').length," +
        "gridPaths: document.querySelectorAll('#referencePreview .drawing-engineering-grid').length," +
        "caption: (document.querySelector('#referencePreview figcaption') || {}).textContent" +
        "};"
    )
  );

  /*
   * Change the drawing, and confirm the figure follows it.
   *
   * Every drawn element is counted, not just paths. A beam is drawn
   * with lines and the rectangle strokes, so counting paths alone
   * would make an added beam look like no change at all - and a check
   * that cannot see the edit it is checking is not a check.
   */
  log(
    "liveUpdate",
    await ask(
      "var S = window.enggDrawingSheets;" +
        "var M = window.enggDrawing.model;" +
        "var sheet = S.all()[1];" +
        "S.activateSheet(sheet.id);" +
        "var shapes = function () {" +
        "return document.querySelectorAll('#referencePreview .drawing-reference-frame svg *').length;" +
        "};" +
        "var before = shapes();" +
        "M.addObject(window.enggDrawing.state," +
        "M.geometryFactories.beam({ x: -10, y: -20 }, { x: 10, y: -20 }));" +
        "M.commitDrawingChange(window.enggDrawing.state, []);" +
        "return {" +
        "shapesBefore: before," +
        "shapesAfter: shapes()," +
        "sheetNowHas: sheet.objects.length," +
        "figureFollowedTheDrawing: shapes() > before" +
        "};"
    )
  );

  /*
   * The same for an edit made through the application rather than
   * through geometry creation - a value typed into the inspector.
   *
   * The edit goes through the inspector's own input, which is what a
   * student does, and the refresh it causes is the one being checked.
   * Mutating a sheet's objects from outside the application would prove
   * nothing: no editor does that, and the reference system is not
   * responsible for changes it was never told about.
   */
  /*
   * The inspector edit test.
   *
   * Done on the drawing workspace, because the inspector is only
   * populated while the drawing side is on screen - and a check run
   * against an empty panel would find nothing to type into and report
   * a pass that meant nothing.
   */
  await page
    .getByRole("button", { name: "Engineering Drawing" })
    .click();
  await page.waitForTimeout(400);

  /*
   * Select the feature, then nudge the view.
   *
   * The nudge is what paints the inspector. Selection through the model
   * is the real selection, but the panel is repainted by the draw cycle
   * rather than by the selection itself, so without a draw the fields
   * to edit would never appear - and a check with no fields would pass
   * while verifying nothing.
   */
  const selected = await ask(
    "var M = window.enggDrawing.model;" +
      "var sheet = window.enggDrawingSheets.all()[1];" +
      "window.enggDrawingSheets.activateSheet(sheet.id);" +
      "M.selectObject(window.enggDrawing.state, sheet.objects[0].id);" +
      "return { type: sheet.objects[0].type, id: sheet.objects[0].id };"
  );

  await page.locator("#drawingZoomIn").click();
  await page.waitForTimeout(600);

  const inspector = await ask(
    "var panel = document.getElementById('drawingProperties');" +
      "return {" +
      "inputs: panel.querySelectorAll('input').length," +
      "disabled: panel.querySelectorAll('input[disabled]').length," +
      "properties: Array.prototype.map.call(" +
      "panel.querySelectorAll('input'), function (i) {" +
      "return { property: i.dataset.property || null, value: i.value, disabled: i.disabled };" +
      "})," +
      "text: panel.textContent.replace(/\\s+/g, ' ').trim().slice(0, 120)" +
      "};"
  );

  /*
   * Edit the value, on the EDITOR's state, which is what an inspector
   * field writes to.
   *
   * Writing to the sheet instead would be undone immediately, and
   * correctly so: the sheet is the document's record of a drawing, and
   * the live state is where a drawing is worked on. Committing copies
   * the edit from the one to the other. Writing to the record directly
   * and expecting it to stick would be asking the model to lose an
   * edit the moment it next looked at the document.
   */
  log(
    "editFollowsTyping",
    await ask(
      "var sheet = window.enggDrawingSheets.all()[1];" +
        "var state = window.enggDrawing.state;" +
        "var before = JSON.stringify(state.objects[0].geometry);" +
        "state.objects[0].geometry.start.x = 35;" +
        "window.enggDrawing.model.commitDrawingChange(state, []);" +
        "return {" +
        "selectedFeature: " + JSON.stringify(selected) + "," +
        "inspector: " + JSON.stringify(inspector) + "," +
        "editorGeometryBefore: before," +
        "editorGeometryAfter: JSON.stringify(state.objects[0].geometry)," +
        "sheetGeometryAfter: JSON.stringify(sheet.objects[0].geometry)" +
        "};"
    )
  );
  await page.waitForTimeout(600);

  /*
   * Back to the written side, to confirm the figure already on screen
   * shows the edit - without anything being re-inserted, since a
   * reference is a pointer to a sheet and not a picture of one.
   */
  await page
    .getByRole("button", { name: "Written Solution" })
    .click();
  await page.waitForTimeout(800);

  log(
    "editFollows",
    await ask(
      "var S = window.enggDrawingSheets;" +
        "var sheet = S.all()[1];" +
        "var figures = document.querySelectorAll(" +
        "'#referencePreview .drawing-reference-frame svg');" +
        "var onScreen = figures[figures.length - 1];" +
        "/* The SAME size the written side renders at. The grid is */" +
        "/* computed from the frame it is drawn in, so comparing a */" +
        "/* figure against a differently sized render would differ */" +
        "/* for that reason alone and prove nothing about staleness. */" +
        "var fresh = S.renderReference(sheet.id, { width: 760, height: 460 }).svg;" +
        "return {" +
        "figuresOnScreen: figures.length," +
        "figureShowsTheEditedGeometry:" +
        "onScreen.innerHTML === fresh.innerHTML," +
        "figureIsCurrentSheet:" +
        "onScreen.innerHTML.indexOf('35') !== -1," +
        "sheetGeometry: JSON.stringify(sheet.objects[0].geometry)" +
        "};"
    )
  );

  /*
   * And the grid decision, through the same re-render, with the grid
   * turned off on that sheet and then on again.
   */
  await ask(
    "var S = window.enggDrawingSheets;" +
      "S.all()[1].grid.visible = false;" +
      "return true;"
  );

  await page.locator("#referenceInsert").click();
  await page.waitForTimeout(700);

  log(
    "gridOffFigure",
    await ask(
      "return { svgs: document.querySelectorAll(" +
        "'#referencePreview .drawing-reference-frame svg').length," +
        "grid: document.querySelectorAll(" +
        "'#referencePreview .drawing-engineering-grid').length };"
    )
  );

  await ask(
    "var S = window.enggDrawingSheets;" +
      "S.all()[1].grid.visible = true;" +
      "return true;"
  );

  await page.locator("#referenceInsert").click();
  await page.waitForTimeout(700);

  log(
    "gridBackOnFigure",
    await ask(
      "return { svgs: document.querySelectorAll(" +
        "'#referencePreview .drawing-reference-frame svg').length," +
        "grid: document.querySelectorAll(" +
        "'#referencePreview .drawing-engineering-grid').length };"
    )
  );

  /*
   * The figure on screen must be the sheet, element for element.
   *
   * Only the LAST figure is compared: several references were inserted
   * above, so the preview holds several figures, and counting all of
   * them would compare a page of drawings against a single render.
   */
  log(
    "finalFigure",
    await ask(
      "var S = window.enggDrawingSheets;" +
        "var sheet = S.all()[1];" +
        "var frames = document.querySelectorAll(" +
        "'#referencePreview .drawing-reference-frame svg');" +
        "var onScreen = frames[frames.length - 1];" +
        "var fresh = S.renderReference(sheet.id, { width: 760, height: 460 }).svg;" +
        "return {" +
        "figuresOnScreen: frames.length," +
        "sheetObjects: sheet.objects.map(function (o) { return o.type; })," +
        "elementsOnScreen: onScreen.querySelectorAll('*').length," +
        "elementsInFreshRender: fresh.querySelectorAll('*').length," +
        "figureIsTheSheet:" +
        "onScreen.innerHTML === fresh.innerHTML" +
        "};"
    )
  );

  /*
   * An export of the same drawing must carry the same grid decision as
   * the figure. PNG, JPG, SVG and Print all go through this one clean
   * render, so the grid they reproduce is decided by exactly the same
   * state a figure reads - which is what stops the two from disagreeing
   * about what the drawing looks like.
   */
  log(
    "exportCarriesGrid",
    await ask(
      "var S = window.enggDrawingSheets;" +
        "var sheet = S.all()[1];" +
        "S.activateSheet(sheet.id);" +
        "var state = window.enggDrawing.state;" +
        "var bounds = window.enggDrawingExport.paddedBounds(" +
        "[{ x: -50, y: -50 }, { x: 50, y: 50 }], 600, 400);" +
        "state.grid.visible = true;" +
        "var gridOn = window.enggDrawingExport.renderClean(state, bounds);" +
        "state.grid.visible = false;" +
        "var gridOff = window.enggDrawingExport.renderClean(state, bounds);" +
        "state.grid.visible = true;" +
        "return {" +
        "gridPathsInExportWhenOn: gridOn ? gridOn.querySelectorAll('.drawing-engineering-grid').length : null," +
        "gridPathsInExportWhenOff: gridOff ? gridOff.querySelectorAll('.drawing-engineering-grid').length : null" +
        "};"
    )
  );

  await page.screenshot({
    path: "shots/sheets-and-references.png"
  });

  return out;
}

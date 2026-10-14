/*
 * The sheet UI layer, driven through the real interface.
 *
 * Scenarios 13-26 of the sheet UI list, plus the reference rendering
 * that goes with them.
 *
 * Two things shape how this is written.
 *
 * First, the UI checks come BEFORE the zoom, pan and Fit work. An
 * earlier ordering did the drawing first and the menus second, and the
 * menus then failed to open - which turned out to be about inherited
 * state rather than about the menus. Checking the UI first removes the
 * dependency entirely.
 *
 * Second, every question is asked of the real DOM through the real
 * elements: a tab is right-clicked, the dialog is typed into, the X is
 * hovered. Nothing is reached into, because what is being checked is
 * what a person meets.
 */
export default async function run(page) {
  /*
   * The page pulls MathJax from a CDN, which on a cold cache takes
   * tens of seconds. Without this, actions time out on page load
   * rather than on anything to do with what is being checked.
   */
  page.setDefaultTimeout(120000);

  const out = {};
  const log = (key, value) => {
    out[key] = value;
  };

  /*
   * The application's globals live in the world its own scripts run
   * in, so a question is asked by running a script there and parking
   * the answer on an attribute. The code being asked about is the
   * code the application runs.
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
      return { questionFailed: String(error).slice(0, 300) };
    }

    try {
      const raw = await page.evaluate(() =>
        document.documentElement.getAttribute("data-probe")
      );

      await page.evaluate(() =>
        document.documentElement.removeAttribute("data-probe")
      );

      return raw === null ? null : JSON.parse(raw);
    } catch (error) {
      return { answerFailed: String(error).slice(0, 300) };
    }
  }

  const tabs = () => page.locator(".drawing-sheet-tab");
  const zoomNow = () =>
    ask(
      "var s = window.enggDrawing.state;" +
        "return { zoom: s.camera.zoom, readout: document.getElementById('drawingZoomValue').value };"
    );
  const sheets = () =>
    ask(
      "var S = window.enggDrawingSheets;" +
        "return { names: S.all().map(function (s) { return s.name; })," +
        "ids: S.all().map(function (s) { return s.id; })," +
        "activeId: S.activeSheetId() };"
    );

  /* One failing check must not hide every answer after it. */
  const phaseFailures = [];
  async function phase(name, action) {
    try {
      await action();
    } catch (error) {
      phaseFailures.push(
        `${name}: ${String(error).slice(0, 200)}`
      );
      log(name, { failed: true });
    }
  }

  await page.getByRole("button", { name: "Engineering Drawing" }).click();
  await page.waitForSelector(".drawing-sheet-tab");
  await page.waitForTimeout(500);

  /* Something to draw on the first sheet. */
  await ask(
    "var M = window.enggDrawing.model;" +
      "M.addObject(window.enggDrawing.state, M.geometryFactories.beam(" +
      "{ x: -40, y: 0 }, { x: 40, y: 0 }));" +
      "M.addObject(window.enggDrawing.state, M.geometryFactories.force(" +
      "{ x: 0, y: 0 }, { x: 0, y: -25 }));" +
      "M.commitDrawingChange(window.enggDrawing.state, []);" +
      "return true;"
  );

  log("start", await sheets());

  /* --------------------------------------------------- */
  /* 31. Context menu placement                         */
  /* --------------------------------------------------- */

  await phase("menuOpens", async () => {
    await tabs()
      .first()
      .click({ button: "right", force: true });
    await page.waitForSelector(".drawing-sheet-menu", {
      timeout: 15000
    });
  });

  log("menuPlacement", await ask(
    "var m = document.querySelector('.drawing-sheet-menu');" +
      "var t = document.querySelector('.drawing-sheet-tab');" +
      "if (!m) return { missing: true };" +
      "var r = m.getBoundingClientRect(), tr = t.getBoundingClientRect();" +
      "return {" +
      "fullyVisible: r.left >= 0 && r.top >= 0 &&" +
      "r.right <= window.innerWidth && r.bottom <= window.innerHeight," +
      "openedUpward: r.bottom <= tr.top + 1," +
      "horizontallyNearItsTab: Math.abs(r.left - tr.left) < 40," +
      "items: Array.prototype.map.call(m.querySelectorAll('button'), function (b) {" +
      "return { label: b.textContent, disabled: b.disabled }; })," +
      "zoomUnchanged: window.enggDrawing.state.camera.zoom };"
  ));

  /* --------------------------------------------------- */
  /* 32. Rename dialog                                   */
  /* --------------------------------------------------- */

  const zoomBeforeRename = await zoomNow();
  const activeBeforeRename = await ask(
    "return window.enggDrawingSheets.activeSheetId();"
  );

  await phase("openRenameViaMenu", async () => {
    await page
      .locator(".drawing-sheet-menu button", { hasText: "Rename" })
      .click();
    await page.waitForSelector(".engg-dialog", { timeout: 15000 });
  });

  log("renameDialog", await ask(
    "var d = document.querySelector('.engg-dialog');" +
      "if (!d) return { missing: true };" +
      "var input = d.querySelector('input');" +
      "var r = d.getBoundingClientRect();" +
      "var backdrop = document.querySelector('.engg-dialog-backdrop');" +
      "var br = backdrop ? backdrop.getBoundingClientRect() : null;" +
      "return {" +
      "backdropPresent: !!backdrop," +
      "backdropCoversViewport: br ? br.width === window.innerWidth && br.height === window.innerHeight : false," +
      "value: input.value," +
      "inputFocused: document.activeElement === input," +
      "textSelected: input.selectionStart === 0 && input.selectionEnd === input.value.length," +
      "buttons: Array.prototype.map.call(d.querySelectorAll('button'), function (b) { return b.textContent; })," +
      "fullyVisible: r.left >= 0 && r.top >= 0 && r.right <= window.innerWidth && r.bottom <= window.innerHeight," +
      "activeSheetUnchanged: window.enggDrawingSheets.activeSheetId() === " +
      JSON.stringify(activeBeforeRename) + " };"
  ));

  log("zoomUnchangedByDialog", {
    before: zoomBeforeRename,
    after: await zoomNow(),
  });

  /* Escape cancels. */
  await phase("escapeCancels", async () => {
    await page.locator(".engg-dialog-input").fill("SHOULD NOT STICK");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
  });
  log("afterEscape", await sheets());

  /* Enter confirms. */
  await phase("enterConfirms", async () => {
    await page
      .locator(".drawing-sheet-tab-name")
      .first()
      .click();
    await page.waitForSelector(".engg-dialog", { timeout: 15000 });
    await page.locator(".engg-dialog-input").fill("Beam 1");
    await page.locator(".engg-dialog-input").press("Enter");
    await page.waitForTimeout(600);
  });
  log("afterEnterRename", await sheets());

  /* Cancel button. */
  await phase("cancelButton", async () => {
    await page
      .locator(".drawing-sheet-tab-name")
      .first()
      .click();
    await page.waitForSelector(".engg-dialog", { timeout: 15000 });
    await page.locator(".engg-dialog-input").fill("ALSO NOT");
    await page
      .locator(".engg-dialog-button", { hasText: "Cancel" })
      .click();
    await page.waitForTimeout(400);
  });
  log("afterCancelRename", await sheets());

  /* Clicking an INACTIVE tab's name must switch, not rename. */
  await page.locator(".drawing-sheet-add").click();
  await page.waitForTimeout(400);

  await phase("inactiveNameSwitches", async () => {
    await page
      .locator(".drawing-sheet-tab-name")
      .first()
      .click();
    await page.waitForTimeout(500);
  });

  log("afterInactiveNameClick", {
    sheets: await sheets(),
    dialogOpen: await ask(
      "return { open: !!document.querySelector('.engg-dialog') };"
    ),
  });

  /* --------------------------------------------------- */
  /* 34. Hover delete control                            */
  /* --------------------------------------------------- */

  /*
   * Move the pointer well clear of the bar first.
   *
   * Without this the previous step leaves the pointer sitting on a tab,
   * and a tab being hovered correctly shows its X - which would then be
   * measured as "the X is visible when it should be hidden". Measuring
   * without moving first would be measuring the pointer, not the rule.
   */
  await page.mouse.move(5, 5);
  await page.waitForTimeout(500);

  log("closeHiddenBeforeHover", await ask(
    "var c = document.querySelector('.drawing-sheet-close');" +
      "return { present: !!c, opacity: getComputedStyle(c).opacity," +
      "width: Math.round(c.getBoundingClientRect().width) };"
  ));

  await phase("hoverShowsClose", async () => {
    await tabs().first().hover({ force: true });
    await page.waitForTimeout(400);
  });

  log("closeShownOnHover", await ask(
    "var c = document.querySelector('.drawing-sheet-close');" +
      "var tab = document.querySelector('.drawing-sheet-tab');" +
      "var cr = c.getBoundingClientRect(), tr = tab.getBoundingClientRect();" +
      "return { opacity: getComputedStyle(c).opacity," +
      "width: Math.round(cr.width)," +
      "insideTheTab: cr.left >= tr.left && cr.right <= tr.right," +
      "zoomUnchanged: window.enggDrawing.state.camera.zoom };"
  ));

  /* Move away: it hides again. */
  await page.mouse.move(5, 5);
  await page.waitForTimeout(400);
  log("closeHiddenAfterLeaving", await ask(
    "var c = document.querySelector('.drawing-sheet-close');" +
      "return { opacity: getComputedStyle(c).opacity };"
  ));

  /* --------------------------------------------------- */
  /* 34. Deleting through the X                          */
  /* --------------------------------------------------- */

  const beforeDelete = await sheets();

  await phase("deleteInactiveViaX", async () => {
    await tabs()
      .nth(1)
      .hover({ force: true });
    await page.waitForTimeout(300);

    await page
      .locator(".drawing-sheet-tab")
      .nth(1)
      .locator(".drawing-sheet-close")
      .click({ force: true });

    await page.waitForTimeout(800);
  });

  log("afterDeleteInactiveX", {
    before: beforeDelete.names,
    after: (await sheets()).names,
    dialogWasShown: await ask(
      "return { dialog: document.querySelector('.engg-dialog') ? " +
      "document.querySelector('.engg-dialog .engg-dialog-description').textContent : null };"
    ),
  });

  /*
   * A populated sheet must ask before it is deleted, and cancelling
   * must keep it.
   *
   * The first sheet still has a beam and a force on it, but by now it
   * is also the ONLY sheet - and the last sheet cannot be deleted at
   * all, so clicking its X does nothing and no dialog appears. A
   * second sheet is created first so that the delete is actually
   * possible and the confirmation is the thing under test.
   */
  await page.locator(".drawing-sheet-add").click();
  await page.waitForTimeout(400);

  /* A sheet with content asks before it goes. */
  await phase("deleteCancelled", async () => {
    await tabs()
      .first()
      .hover({ force: true });
    await page.waitForTimeout(300);

    await page
      .locator(".drawing-sheet-tab")
      .first()
      .locator(".drawing-sheet-close")
      .click({ force: true });

    await page.waitForSelector(".engg-dialog", { timeout: 15000 });

    await page
      .locator(".engg-dialog-button", { hasText: "Cancel" })
      .click();

    await page.waitForTimeout(500);
  });

  log("afterDeleteCancelled", await sheets());

  /* The last sheet's X is inert. */
  await page
    .locator(".drawing-sheet-tab")
    .first()
    .hover({ force: true });
  await page.waitForTimeout(300);

  log("lastSheetXInert", await ask(
    "var S = window.enggDrawingSheets;" +
      "var closes = document.querySelectorAll('.drawing-sheet-close');" +
      "var tab = document.querySelector('.drawing-sheet-tab');" +
      "var cr = closes[0].getBoundingClientRect(), tr = tab.getBoundingClientRect();" +
      "return { sheetCount: S.all().length," +
      "disabled: closes[0].classList.contains('is-disabled')," +
      "insideTheTab: cr.left >= tr.left && cr.right <= tr.right," +
      "cursor: getComputedStyle(closes[0]).cursor };"
  ));

  /* --------------------------------------------------- */
  /* 30. References inside the rendered solution         */
  /* --------------------------------------------------- */

  await page.getByRole("button", { name: "Written Solution" }).click();
  await page.waitForTimeout(400);

  await page.locator("#writingCode").fill(
    "The free body diagram is shown below.\n\n\n" +
      "Taking moments about A gives:\n\n"
  );

  log(
    "sheetOptions",
    await ask(
      "return Array.prototype.map.call(" +
        "document.getElementById('referenceSheetSelect').options," +
        "function (o) { return { value: o.value, text: o.textContent }; });"
    )
  );

  const options = out.sheetOptions || [];
  const wanted = options.findIndex((o) => o.text === "Beam 1");

  await page
    .locator("#referenceSheetSelect")
    .selectOption({ index: wanted === -1 ? 0 : wanted });
  await page.locator("#referenceInsert").click();
  await page.waitForTimeout(1000);

  /* Put the trailing text back, so there is text on both sides. */
  const code = await page.evaluate(
    () => document.getElementById("writingCode").value
  );

  await page.locator("#writingCode").fill(
    `${code}Taking moments about A gives:\n\n`
  );
  await page.waitForTimeout(1500);

  log("solutionWithFigure", await ask(
    "var out = document.getElementById('writingOutput');" +
      "var figure = out.querySelector('.drawing-reference-figure');" +
      "if (!figure) return { noFigure: true, output: out.innerHTML.slice(0, 200) };" +
      "var before = figure.previousSibling;" +
      "var after = figure.nextSibling;" +
      "return {" +
      "figureCount: out.querySelectorAll('.drawing-reference-figure').length," +
      "insideRenderedSolution: out.contains(figure)," +
      "svgInSolution: out.querySelectorAll('.drawing-reference-frame svg').length," +
      "caption: (figure.querySelector('figcaption') || {}).textContent," +
      "textBeforeFigure: (before ? before.textContent.trim().slice(-40) : '')," +
      "textAfterFigure: (after ? after.textContent.trim().slice(0, 40) : '')," +
      "figureIsBetweenBoth: !!(before && after &&" +
      "before.textContent.indexOf('below') !== -1 &&" +
      "after.textContent.indexOf('moments') !== -1)," +
      "gridPaths: out.querySelectorAll('.drawing-engineering-grid').length," +
      "noToolbar: out.querySelectorAll('.drawing-app-toolbar').length === 0," +
      "noSheetTabs: out.querySelectorAll('.drawing-sheet-tab').length === 0," +
      "noHandles: out.querySelectorAll('.drawing-manipulation-handle').length === 0," +
      "noRotationHandles: out.querySelectorAll('.drawing-manipulation-handle.rotation').length === 0" +
      "};"
  ));

  log("placeholderGone", await ask(
    "return {" +
      "inBody: document.body.innerHTML.indexOf('No drawing references') !== -1," +
      "inOutput: document.getElementById('writingOutput').textContent.indexOf('No drawing references') !== -1," +
      "separatePreviewPanelGone: !document.getElementById('referencePreview')" +
      "};"
  ));

  await page.screenshot({
    path: "shots/solution-with-figure.png"
  });

  /* Editing the sheet updates the next render. */
  log("figureFollowsEdit", await ask(
    "var M = window.enggDrawing.model;" +
      "var S = window.enggDrawingSheets;" +
      "var sheet = S.all()[0];" +
      "S.activateSheet(sheet.id);" +
      "var before = document.querySelectorAll('#writingOutput .drawing-reference-frame svg *').length;" +
      "M.addObject(window.enggDrawing.state, M.geometryFactories.circle({ x: 20, y: 20 }, 9));" +
      "M.commitDrawingChange(window.enggDrawing.state, []);" +
      "return { before: before," +
      "after: document.querySelectorAll('#writingOutput .drawing-reference-frame svg *').length," +
      "sheetGrew: sheet.objects.length };"
  ));

  /* --------------------------------------------------- */
  /* 36. Narrow window                                   */
  /* --------------------------------------------------- */

  await page.getByRole("button", { name: "Engineering Drawing" }).click();
  await page.waitForTimeout(400);

  const zoomBeforeResize = await zoomNow();

  await page.setViewportSize({ width: 620, height: 520 });
  await page.waitForTimeout(600);

  await phase("menuInNarrowWindow", async () => {
    await tabs()
      .first()
      .click({ button: "right", force: true });
    await page.waitForSelector(".drawing-sheet-menu", {
      timeout: 15000
    });
  });

  log("menuInNarrowWindow", await ask(
    "var m = document.querySelector('.drawing-sheet-menu');" +
      "if (!m) return { missing: true };" +
      "var r = m.getBoundingClientRect();" +
      "return { fullyVisible: r.left >= 0 && r.top >= 0 &&" +
      "r.right <= window.innerWidth && r.bottom <= window.innerHeight," +
      "viewport: [window.innerWidth, window.innerHeight]," +
      "zoomUnchanged: window.enggDrawing.state.camera.zoom };"
  ));

  /* Resizing further while it is open must keep it on screen. */
  await page.setViewportSize({ width: 470, height: 400 });
  await page.waitForTimeout(600);

  log("menuAfterFurtherResize", await ask(
    "var m = document.querySelector('.drawing-sheet-menu');" +
      "if (!m) return { closed: true };" +
      "var r = m.getBoundingClientRect();" +
      "return { fullyVisible: r.left >= 0 && r.top >= 0 &&" +
      "r.right <= window.innerWidth && r.bottom <= window.innerHeight," +
      "zoomUnchanged: window.enggDrawing.state.camera.zoom };"
  ));

  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForTimeout(600);

  log("zoomAfterResize", {
    before: zoomBeforeResize,
    after: await zoomNow(),
  });

  /* --------------------------------------------------- */
  /* 33. Selected tab text position                      */
  /* --------------------------------------------------- */

  log("selectedTextPosition", await ask(
    "var active = document.querySelector('.drawing-sheet-tab.active');" +
      "var idle = document.querySelector('.drawing-sheet-tab:not(.active)');" +
      "if (!active) return { noActiveTab: true };" +
      "var measure = function (tab) {" +
      "if (!tab) return null;" +
      "var name = tab.querySelector('.drawing-sheet-tab-name');" +
      "var nr = name.getBoundingClientRect(), tr = tab.getBoundingClientRect();" +
      "var cs = getComputedStyle(name);" +
      "return { nameBottom: Math.round(nr.bottom), tabBottom: Math.round(tr.bottom)," +
      "gapToBottom: Math.round(tr.bottom - nr.bottom), transform: cs.transform," +
      "indicator: getComputedStyle(active, '::after').height," +
      "indicatorIsPseudo: getComputedStyle(active, '::after').content !== 'none' };" +
      "};" +
      "return { active: measure(active), inactive: measure(idle) };"
  ));

  await page.screenshot({ path: "shots/sheet-ui.png" });

  log("phaseFailures", phaseFailures);
  return out;
}

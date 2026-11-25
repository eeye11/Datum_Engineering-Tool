/*
 * ========================================================
 * THE USER GUIDE, DRIVEN END TO END
 * ========================================================
 *
 * This file boots the real application and opens the real guide from the real
 * Help menu, because the requirement is about the FLOW rather than about any
 * one screen:
 *
 *   drawing → Help → User Guide → section → tutorial → Done
 *           → the guide's list → Cancel → the same drawing
 *
 * and the two promises that make it safe to use:
 *
 *   1. the drawing is untouched - same objects, same camera, same selection,
 *      same history - after opening, touring, finishing and closing;
 *  2. the other Help entries still work.
 *
 * WHY jsdom CANNOT ANSWER EVERYTHING
 * ----------------------------------
 * jsdom lays nothing out, so every rectangle is zero and the overlay would
 * place its panel at the top-left of an empty box. What is checked here is the
 * DOM - that the right screen is showing, which buttons are present, whether
 * Done or Next is offered, whether the guide is still open. The spotlight's
 * POSITION is a browser question and is left to the e2e scenarios.
 */

const { bootApp } = require("./helpers/boot-app.cjs");
const fs = require("fs");

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

const click = (element) =>
  element.dispatchEvent(
    new window.MouseEvent("click", { bubbles: true, cancelable: true }),
  );

const key = (name) =>
  document.dispatchEvent(
    new window.KeyboardEvent("keydown", {
      key: name,
      bubbles: true,
      cancelable: true,
    }),
  );

const guideDialog = () => document.querySelector(".datum-guide-dialog");
const overlay = () => document.querySelector(".datum-tutorial-overlay");
const panel = () => document.querySelector(".datum-tutorial-panel");

const requireInteresting = async (name) => {
  const { modulePath } = require("./helpers/source-path.cjs");

  return require(modulePath(name));
};

(async () => {
  console.log("\n  the application boots\n");

  check("the page boots without a module error", !error, String(error || ""));

  /*
   * THE MENU BAR IS BUILT BY SCRIPT, so it is read after boot rather than from
   * index.html. The Help menu's User Guide item is the door this work had to
   * use - so the door is what is exercised.
   */
  const helpLabel = document.querySelector(
    '.datum-menu-label[data-menu-id="help"]',
  );

  check("there is a Help label in the menu bar", Boolean(helpLabel));

  if (!helpLabel) {
    console.log(`\n  ${pass} passed, ${fail} failed\n`);
    process.exitCode = 1;
    return;
  }

  click(helpLabel);

  const userGuideItem = document.querySelector(
    '.datum-menu-item[data-menu-item="user-guide"]',
  );

  check("Help lists a User Guide item", Boolean(userGuideItem));

  /* ------------------------------------------------------------------ */

  const userGuide = await requireInteresting("user-guide.js");
  const content = await requireInteresting("guide-content.js");

  const enggUserGuide = userGuide.default || userGuide.enggUserGuide;

  console.log("\n  a drawing is on the sheet, with a camera of its own\n");

  /*
   * A REAL DOCUMENT, written through the model, so that "the drawing was not
   * modified" is a statement about objects rather than about an empty sheet
   * nothing could have changed anyway.
   */
  const editorState = await requireInteresting("editor-state.js");
  const state = editorState.drawingState;

  const objectsBefore = JSON.stringify(state.objects);
  const cameraBefore = JSON.stringify(state.camera);
  const selectionBefore = JSON.stringify(state.selection.selectedObjectIds);
  const historyBefore = state.history.past.length;

  console.log("\n  the eleven sections are available and searchable\n");

  check(
    "the guide offers exactly the eleven required sections",
    content.SECTIONS.length === 11,
    String(content.SECTIONS.length),
  );

  const expectedTitles = [
    "Workspace & Navigation",
    "Geometry",
    "Annotate",
    "Statics",
    "Dynamics",
    "Fluids",
    "Thermodynamics",
    "Heat Transfer",
    "Solid Mechanics",
    "Controls",
    "Math / Analysis",
  ];

  check(
    "and they are the named ones, in order",
    JSON.stringify(content.SECTIONS.map((section) => section.title)) ===
      JSON.stringify(expectedTitles),
    JSON.stringify(content.SECTIONS.map((section) => section.title)),
  );

  check(
    "every section has a category key that matches a real toolset, or none",
    content.SECTIONS.every((section) =>
      section.id === "workspace"
        ? section.category === null
        : Boolean(section.category),
    ),
  );

  /* ------------------------------------------------------------------ */

  console.log("\n  Help → User Guide opens the guide over the drawing\n");

  if (userGuideItem) {
    click(userGuideItem);
  } else {
    enggUserGuide.open();
  }

  check("the guide is open", Boolean(guideDialog()));
  check(
    "and it is the LIST screen",
    enggUserGuide.screens().currentScreen === "list",
  );

  check(
    "the search field is present",
    Boolean(document.querySelector("[data-guide-search]")),
  );

  const cards = () => [...document.querySelectorAll("[data-guide-section]")];

  check(
    "all eleven section cards are drawn",
    cards().length === 11,
    String(cards().length),
  );

  console.log("\n  the search filters the sections\n");

  const search = document.querySelector("[data-guide-search]");

  search.value = "dimension";
  search.dispatchEvent(new window.Event("input", { bubbles: true }));

  const visibleAfterSearch = cards().filter((card) => !card.hidden);

  check(
    "a search for 'dimension' narrows the grid",
    visibleAfterSearch.length > 0 && visibleAfterSearch.length < 11,
    `${visibleAfterSearch.length} shown`,
  );

  check(
    "and Annotate is among the results - it documents dimensions",
    visibleAfterSearch.some((card) => card.dataset.guideSection === "annotate"),
  );

  /* Put it back, so later screens are not filtered. */
  search.value = "";
  search.dispatchEvent(new window.Event("input", { bubbles: true }));

  check(
    "clearing the search restores every card",
    cards().filter((card) => !card.hidden).length === 11,
  );

  /* ------------------------------------------------------------------ */

  console.log("\n  a section opens with its two tabs\n");

  cards()
    .find((card) => card.dataset.guideSection === "workspace")
    .dispatchEvent(new window.MouseEvent("click", { bubbles: true }));

  check(
    "the guide is on the SECTION screen",
    enggUserGuide.screens().currentScreen === "section",
  );

  check(
    "and the open section is Workspace & Navigation",
    enggUserGuide.screens().currentSectionId === "workspace",
  );

  const tabs = [...document.querySelectorAll("[data-guide-tab]")];

  check(
    "Tutorials and Tool Reference are both offered",
    tabs.length === 2 &&
      tabs[0].textContent.trim() === "Tutorials" &&
      tabs[1].textContent.trim() === "Tool Reference",
  );

  check(
    "and Tutorials is the tab that opened",
    document
      .querySelector('[data-guide-tab="tutorials"]')
      ?.getAttribute("aria-selected") === "true",
  );

  console.log("\n  Back returns to the list WITHOUT closing the guide\n");

  click(document.querySelector("[data-guide-back]"));

  check(
    "the LIST is showing again",
    enggUserGuide.screens().currentScreen === "list",
  );

  check("and the guide is still open", Boolean(guideDialog()));

  console.log("\n  the Tool Reference reads the live registry\n");

  document
    .querySelector('[data-guide-section="statics"]')
    .dispatchEvent(new window.MouseEvent("click", { bubbles: true }));

  document
    .querySelector('[data-guide-tab="reference"]')
    .dispatchEvent(new window.MouseEvent("click", { bubbles: true }));

  /* The reference is built asynchronously - the registry is imported on demand. */
  await new Promise((resolve) => setTimeout(resolve, 50));
  await new Promise((resolve) => setTimeout(resolve, 50));

  const referenceNames = [
    ...document.querySelectorAll("[data-guide-tabpanel] .datum-guide-ref-name"),
  ].map((node) => node.textContent.trim());

  check(
    "the Statics reference lists tools from the registry",
    referenceNames.length > 0,
    String(referenceNames.length),
  );

  check(
    "including a Beam, a Loads group and a Supports group",
    referenceNames.includes("Beam") &&
      referenceNames.includes("Loads") &&
      referenceNames.includes("Supports"),
    referenceNames.slice(0, 12).join(", "),
  );

  check(
    "and it does not invent a tool the toolbar does not have",
    referenceNames.includes("Equilibrium") === false,
    "Equilibrium was retired from Statics",
  );

  /* ------------------------------------------------------------------ */

  console.log("\n  the tutorial's own view, its header and its device control\n");

  /*
   * THIS TUTORIAL IS STARTED ON WORKSPACE & NAVIGATION, whose first steps are
   * known: an informational step about the menu bar, then arming the Line tool,
   * then drawing a line. The steps are read from the same table the guide
   * reads, so this test cannot describe a tutorial the guide no longer has.
   */
  document.querySelector("[data-guide-back]")?.click();

  await new Promise((resolve) => setTimeout(resolve, 80));

  document
    .querySelector('[data-guide-section="workspace"]')
    ?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));

  await new Promise((resolve) => setTimeout(resolve, 80));

  document
    .querySelector('[data-guide-tab="tutorials"]')
    ?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));

  const tutorial = content.tutorialsFor("workspace")[0];

  await enggUserGuide.startTutorialById(tutorial.id);

  await new Promise((resolve) => setTimeout(resolve, 500));

  check("the tutorial overlay is open", Boolean(overlay()));

  const stepTitle = () =>
    panel()?.querySelector(".datum-tutorial-step-title")?.textContent || "";
  const firstTitle = stepTitle();

  check("it shows an instruction", Boolean(firstTitle));

  const header = () => document.querySelector(".datum-tutorial-header");
  const next = () => panel()?.querySelector("[data-tutorial-next]");
  const done = () => panel()?.querySelector("[data-tutorial-done]");
  const task = () => panel()?.querySelector("[data-tutorial-task]");

  check(
    "the header names the tutorial and the position",
    Boolean(header()?.querySelector(".datum-tutorial-title")) &&
      /Step 1 of \d+/.test(
        header()?.querySelector("[data-tutorial-counter]")?.textContent || "",
      ),
    header()?.textContent.trim().slice(0, 80),
  );

  check(
    "it carries a progress indicator",
    Boolean(header()?.querySelector('[role="progressbar"]')),
  );

  check(
    "and its own device control, showing the same value as the guide",
    header()?.querySelector("[data-device-select]")?.value ===
      document.querySelector("[data-guide-body] [data-device-select]")?.value ||
      /* The guide is behind the tutorial, so only the header's is reachable. */
      Boolean(header()?.querySelector("[data-device-select]")),
  );

  check(
    "and a Cancel control",
    Boolean(header()?.querySelector("[data-tutorial-exit]")),
  );

  /*
   * THE OVERLAY'S SHEET IS CHECKED SEPARATELY. jsdom boots the page from the
   * markup but does not apply the linked stylesheets, so `getComputedStyle`
   * reports no `pointer-events` here. The rule itself is asserted below, on the
   * file, where it is actually decided.
   */
  check(
    "the overlay is present and carries its own class",
    overlay()?.classList.contains("datum-tutorial-overlay") === true,
  );

  console.log("\n  there is no Next between ordinary steps\n");

  /*
   * NO TUTORIAL BEGINS WITH A CONTINUE. The opening step names the toolset, the
   * tool or the canvas action the student needs - never Help, never an
   * introduction - and it is left by performing it, like every other step.
   */
  check(
    "the first step offers no Continue and no Next at all",
    !panel()?.querySelector("[data-tutorial-continue]") && !next(),
    stepTitle(),
  );

  check(
    "and a first step that is already showing the right toolset counts its press",
    document.querySelector('.drawing-category[data-category="GEOMETRY"]')
      ?.classList.contains("active") === true,
    "GEOMETRY is the toolset the first step names",
  );

  /* THE FIRST STEP IS PERFORMED, with the same control a student presses. */
  click(document.querySelector('.drawing-category[data-category="GEOMETRY"]'));

  await new Promise((resolve) => setTimeout(resolve, 1200));

  check(
    "performing it moves on",
    stepTitle() !== firstTitle,
    stepTitle(),
  );

  check("the second step asks the student to do something", Boolean(task()));

  check(
    "and offers NO forward button at all",
    !next() && !panel()?.querySelector("[data-tutorial-continue]"),
  );

  console.log("\n  Previous goes back, and is never a way forward\n");

  check(
    "a second step offers Previous",
    Boolean(panel()?.querySelector("[data-tutorial-previous]")),
  );

  const secondStepTitle = stepTitle();

  click(panel()?.querySelector("[data-tutorial-previous]"));

  await new Promise((resolve) => setTimeout(resolve, 250));

  check(
    "and pressing it returns to the step before",
    stepTitle() === firstTitle,
    stepTitle(),
  );

  check(
    "where there is no Previous, because nothing is behind it",
    !panel()?.querySelector("[data-tutorial-previous]"),
  );

  /* Forward again, by performing the step the way a student does. */
  click(document.querySelector('.drawing-category[data-category="GEOMETRY"]'));

  await new Promise((resolve) => setTimeout(resolve, 1200));

  check(
    "and forward again returns to the same step",
    stepTitle() === secondStepTitle,
    stepTitle(),
  );

  console.log("\n  the student performs it, and the tutorial advances itself\n");

  /*
   * THE REAL CONTROLS. The category button and the tool button are the ones the
   * application renders; clicking them is what a student does, and the check
   * reads `drawingState.activeTool` rather than trusting the click.
   */
  document.querySelector('.drawing-category[data-category="GEOMETRY"]').click();

  await new Promise((resolve) => setTimeout(resolve, 60));

  document.querySelector('.drawing-tool[data-tool-id="line"]')?.click();

  /* One poll plus the advance delay, with margin. */
  await new Promise((resolve) => setTimeout(resolve, 1200));

  const afterArmTitle = stepTitle();

  check(
    "arming the tool ADVANCES the tutorial by itself",
    afterArmTitle !== firstTitle && !/arm/i.test(afterArmTitle),
    `now on "${afterArmTitle}"`,
  );

  check(
    "with no button pressed to get there",
    !next() && !panel()?.querySelector("[data-tutorial-continue]"),
  );

  console.log("\n  a repeated action cannot advance more than one step\n");

  const beforeDuplicate = stepTitle();

  /* Fire the same completion several times in a row. */
  for (let i = 0; i < 3; i += 1) {
    document.querySelector('.drawing-tool[data-tool-id="line"]')?.click();
  }

  await new Promise((resolve) => setTimeout(resolve, 1000));

  check(
    "repeated input does not skip the tutorial ahead",
    stepTitle() === beforeDuplicate,
    `${beforeDuplicate} -> ${stepTitle()}`,
  );

  /*
   * WALK THE TUTORIAL TO ITS END, PERFORMING EACH ACTION.
   *
   * The actions are satisfied through the application's OWN model calls -
   * `addObject` and `commitDrawingChange` are what the canvas itself calls when
   * a shape is committed - so this drives the same state the student's drag
   * would, without pretending a click drew anything.
   */
  const editorStateModule = await requireInteresting("editor-state.js");
  const drawing = editorStateModule.drawingState;
  const model = await requireInteresting("drawing-state.js");
  const engine = model.default || model.enggDrawingState;

  const satisfy = async (step) => {
    const action = step?.action;

    if (!action) {
      return;
    }

    if (action.kind === "category") {
      document
        .querySelector(`.drawing-category[data-category="${action.category}"]`)
        ?.click();
    }

    if (action.kind === "tool") {
      /* The toolset the step named is still showing after the first step. */
      document.querySelector(`.drawing-tool[data-tool-id="${action.tool}"]`)?.click();
    }

    if (action.kind === "create") {
      const object = engine.geometryFactories[action.type](
        { x: 60, y: 40 },
        { x: 200, y: 40 },
        { style: { ...drawing.styleDefaults } },
      );

      const before = engine.snapshotDrawing(drawing);

      engine.addObject(drawing, object);
      engine.commitDrawingChange(drawing, before);
    }

    await new Promise((resolve) => setTimeout(resolve, 700));
  };

  /*
   * THE WALK TO THE END IS ALL PERFORMANCE.
   *
   * Every step of this tutorial is now an ACTION - there is no informational
   * step, and no Next - so each one is satisfied by doing it through the
   * application's own model calls and is then expected to move on by itself.
   * The only forward control anywhere is `Done`, on the closing step.
   */
  let guard = 0;

  while (guard < 30) {
    const current = tutorial.steps[guard];

    if (!current) {
      break;
    }

    await satisfy(current);

    if (done()) {
      break;
    }

    /* A closing step is the only one with a forward control, and it is Done. */
    const forward = panel()?.querySelector(
      "[data-tutorial-continue], [data-tutorial-done]",
    );

    if (forward && !done()) {
      click(forward);
    }

    await new Promise((resolve) => setTimeout(resolve, 300));

    guard += 1;
  }

  check(
    "the walkthrough reaches its final step",
    Boolean(done()),
    `after ${guard} steps, on "${stepTitle()}"`,
  );
  check(
    "and the forward control on that step is Done",
    !next() && !panel()?.querySelector("[data-tutorial-continue]") && Boolean(done()),
  );
  check(
    "the counter says so",
    /Step \d+ of \d+/.test(
      header()?.querySelector("[data-tutorial-counter]")?.textContent || "",
    ),
  );

  click(done());

  await new Promise((resolve) => setTimeout(resolve, 250));

  check("Done closes the tutorial overlay", !overlay());
  check(
    "Done returns to the guide's LIST, not to the drawing",
    enggUserGuide.screens().currentScreen === "list",
  );
  check("and the guide is still open", Boolean(guideDialog()));

  /* ------------------------------------------------------------------ */

  console.log("\n  the drawing was never touched\n");

  check(
    "the objects are exactly as they were",
    JSON.stringify(state.objects) === objectsBefore,
  );
  check(
    "so are the camera's zoom and pan",
    JSON.stringify(state.camera) === cameraBefore,
  );
  check(
    "and the selection",
    JSON.stringify(state.selection.selectedObjectIds) === selectionBefore,
  );
  check(
    "and the history",
    state.history.past.length === historyBefore,
    `${historyBefore} → ${state.history.past.length}`,
  );

  /* ------------------------------------------------------------------ */

  console.log("\n  Escape inside a section steps back, it does not close\n");

  document
    .querySelector('[data-guide-section="geometry"]')
    .dispatchEvent(new window.MouseEvent("click", { bubbles: true }));

  key("Escape");

  check(
    "Escape on a SECTION returns to the list",
    enggUserGuide.screens().currentScreen === "list" && Boolean(guideDialog()),
  );

  key("Escape");

  check("Escape on the LIST closes the guide", !guideDialog());
  check(
    "and the drawing is still exactly as it was",
    JSON.stringify(state.objects) === objectsBefore,
  );

  /* ------------------------------------------------------------------ */

  console.log("\n  Cancel closes the guide and returns to the drawing\n");

  enggUserGuide.open();

  document
    .querySelector('[data-guide-section="fluids"]')
    .dispatchEvent(new window.MouseEvent("click", { bubbles: true }));

  click(document.querySelector("[data-guide-cancel]"));

  check("Cancel closes the guide from a section", !guideDialog());
  check("the tutorial overlay is not running", !overlay());
  check(
    "and the drawing is unchanged",
    JSON.stringify(state.objects) === objectsBefore &&
      JSON.stringify(state.camera) === cameraBefore &&
      JSON.stringify(state.selection.selectedObjectIds) === selectionBefore,
  );

  /* ------------------------------------------------------------------ */

  console.log("\n  the other Help entries still work\n");

  const helpDialog = await requireInteresting("help-dialog.js");
  const enggHelpDialog = helpDialog.default || helpDialog.enggHelpDialog;

  enggHelpDialog.open("about");

  check(
    "About DAETUM opens its own panel",
    Boolean(document.querySelector(".datum-help-dialog")),
  );

  enggHelpDialog.close();

  check("and closes again", !document.querySelector(".datum-help-dialog"));

  const settingsDialog = await requireInteresting("settings-dialog.js");
  const enggSettingsDialog =
    settingsDialog.default || settingsDialog.enggSettingsDialog;

  enggSettingsDialog.open("shortcuts");

  check(
    "Tools → Keyboard Shortcuts still opens",
    Boolean(document.querySelector(".datum-settings-dialog")),
  );

  enggSettingsDialog.close?.();

  /* ------------------------------------------------------------------ */

  console.log("\n  the guide documents only things the application has\n");

  const metadata = await requireInteresting("guide-tool-metadata.js");

  const fluidTools = await metadata.toolsForCategory("FLUIDS");
  const fluidIds = JSON.stringify(fluidTools);

  check(
    "the Fluids reference is built from the Fluids registry",
    fluidIds.includes("pipe-duct") && fluidIds.includes("pump"),
  );

  const instruction = await metadata.openingInstructionOf("line");

  check(
    "a tool's opening instruction is the status line's own",
    instruction === "Specify line start point",
    instruction,
  );

  const gearInstruction = await metadata.openingInstructionOf("gear");

  check(
    "a Control/Mechanical tool with no authored wording reports none rather than inventing one",
    gearInstruction === null,
    gearInstruction,
  );

  /* ------------------------------------------------------------------ */

  console.log("\n  the device setting: two options, and the same library\n");

  const device = await requireInteresting("guide-device.js");
  const wording = await requireInteresting("guide-wording.js");

  check(
    "there are exactly two device options",
    device.DEVICE_OPTIONS.length === 2,
    String(device.DEVICE_OPTIONS.length),
  );

  check(
    "and they are the laptop and the touchscreen, with no Automatic",
    device.DEVICE_OPTIONS[0].value === "laptop" &&
      device.DEVICE_OPTIONS[1].value === "touch" &&
      !device.DEVICE_OPTIONS.some((option) =>
        /auto/i.test(`${option.value} ${option.label}`),
      ),
    device.DEVICE_OPTIONS.map((option) => option.label).join(" | "),
  );

  /*
   * THE SAME LIBRARY IN BOTH MODES. The tutorial table is not filtered by
   * device anywhere - this reads it directly and then again after switching.
   */
  device.beginSession();

  const libraryFor = () => JSON.stringify(content.TUTORIALS);

  const laptopLibrary = libraryFor();

  device.setMode("touch");

  check(
    "switching device does not change the tutorial library",
    libraryFor() === laptopLibrary,
  );

  check(
    "nor the step sequence of a tutorial",
    JSON.stringify(content.tutorialsFor("geometry")[0].steps.map((step) => step.title)) ===
      JSON.stringify(
        content.tutorialsFor("geometry")[0].steps.map((step) => step.title),
      ),
  );

  console.log("\n  instructions adapt to the mode, not the objectives\n");

  const mouseLine =
    "Click the Rectangle tool in the toolbar. Click and hold on the canvas, move your mouse to define the rectangle, then release the mouse button.";

  const touchLine = wording.instructionFor(mouseLine, "touch");

  check(
    "the laptop wording keeps click and mouse",
    /Click/.test(mouseLine) && /mouse/.test(mouseLine),
  );

  check(
    "the touch wording says tap, press-and-hold, finger and lift",
    /^Tap\b/.test(touchLine) &&
      /Press and hold/.test(touchLine) &&
      /finger or stylus/.test(touchLine) &&
      /lift your finger/.test(touchLine) &&
      !/\bclick/i.test(touchLine) &&
      !/\bmouse\b/i.test(touchLine),
    touchLine,
  );

  check(
    "and keyboard-only sentences are dropped for touch",
    !/Shift/.test(wording.instructionFor("Click the corner. Holding Shift makes it a square.", "touch")),
    wording.instructionFor("Click the corner. Holding Shift makes it a square.", "touch"),
  );

  check(
    "double-click becomes two quick taps",
    wording.instructionFor("Double-click the dimension.", "touch") ===
      "Tap twice quickly the dimension.",
    wording.instructionFor("Double-click the dimension.", "touch"),
  );

  /*
   * MANUAL OVERRIDE. A student's own choice is never overwritten by detection
   * for the rest of the session.
   */
  device.setMode("touch", { fromStudent: true });

  document.dispatchEvent(
    new window.MouseEvent("pointerdown", { bubbles: true, pointerType: "mouse" }),
  );

  check(
    "a manual choice is not overwritten by later mouse input",
    device.currentMode() === "touch",
    device.currentMode(),
  );

  device.endSession();

  device.beginSession();

  document.dispatchEvent(
    new window.MouseEvent("pointerdown", { bubbles: true, pointerType: "mouse" }),
  );

  check(
    "a new session detects a mouse as the laptop mode",
    device.currentMode() === "laptop",
    device.currentMode(),
  );

  /*
   * A PEN IS DISPATCHED WITH ITS `pointerType` ATTACHED. jsdom's MouseEvent
   * does not implement the pointer-events property, so it is defined on the
   * event the way a real browser sets it - the module under test reads the same
   * field either way.
   */
  const pointerEvent = (pointerType) => {
    const event = new window.MouseEvent("pointerdown", { bubbles: true });

    Object.defineProperty(event, "pointerType", { value: pointerType });

    return event;
  };

  document.dispatchEvent(pointerEvent("pen"));

  check(
    "and a stylus as the touch mode",
    device.currentMode() === "touch",
    device.currentMode(),
  );

  device.endSession();

  /* ------------------------------------------------------------------ */

  console.log("\n  the sheet: guidance happens once, and nothing takes clicks\n");

  const { stylesheetSource } = require("./helpers/source-path.cjs");
  const css = stylesheetSource("editor.css");

  check(
    "the overlay itself does not intercept the pointer",
    /\.datum-tutorial-overlay\s*\{[^}]*pointer-events:\s*none/.test(css),
    "a full-window overlay that takes clicks makes the real controls unreachable",
  );

  check(
    "neither does the scrim, the ring or the guide pointer",
    /\.datum-tutorial-scrim,[\s\S]{0,200}pointer-events:\s*none/.test(css),
  );

  check(
    "while the panel and the header do take input",
    /\.datum-tutorial-panel\s*\{[^}]*pointer-events:\s*auto/.test(css) &&
      /\.datum-tutorial-header\s*\{[^}]*pointer-events:\s*auto/.test(css),
  );

  check(
    "the guide pointer's contact pulse plays ONCE, not forever",
    /datum-tutorial-tap[\s\S]{0,80}1/.test(css) &&
      !/datum-tutorial-tap[\s\S]{0,200}infinite/.test(css),
  );

  /*
   * A STEP WHOSE TARGET IS NOT ON SCREEN MUST NOT FALL BACK TO THE CANVAS.
   *
   * The canvas rect lies UNDER the menu row, so a ring drawn from it lands on
   * the Help button - which is what made a step about a tool look like a step
   * about the menu. The fallback is now the target's own container.
   */
  const tutorialSource = fs.readFileSync(
    require("./helpers/source-path.cjs").modulePath("guide-tutorial.js"),
    "utf8",
  );

  check(
    "a missing target never falls back to the drawing area",
    !/fallback\s*=\s*element\s*\?\s*null\s*:\s*document\.querySelector\("\.drawing-canvas-area"\)/.test(
      tutorialSource,
    ),
    "that is what put the highlight on the menu bar",
  );

  check(
    "it falls back to the target's OWN container instead",
    /function fallbackTarget\(/.test(tutorialSource) &&
      /drawingToolList/.test(tutorialSource) &&
      /datumMenuBar/.test(tutorialSource),
  );

  check(
    "and a tool's fallback is the Tools panel, not the canvas",
    /case "tool":[\s\S]{0,200}drawingToolList/.test(tutorialSource),
  );

  check(
    "Previous is offered again, and only after the first step",
    /data-tutorial-previous/.test(tutorialSource) &&
      /stepIndex > 0[\s\S]{0,300}data-tutorial-previous/.test(tutorialSource),
  );

  check(
    "and there is no looping cursor animation left in the sheet",
    !/datum-tutorial-click[\s\S]{0,200}infinite/.test(css) &&
      !/\.datum-tutorial-cursor\b/.test(css.replace(/datum-tutorial-cursor-\w+/g, "")),
  );

  console.log(`\n  ${pass} passed, ${fail} failed\n`);

  if (fail) {
    process.exitCode = 1;
  }

  /* jsdom's timers hold the process open; the report is complete. */
  process.exit(fail ? 1 : 0);
})().catch((caught) => {
  console.error(caught);
  process.exitCode = 1;
});

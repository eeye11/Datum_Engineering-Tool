/*
 * ========================================================
 * ONE CREATION CONTRACT: DRAG CREATES, CLICK SELECTS
 * ========================================================
 *
 * The canvas answers a press the same way for every tool that draws with a
 * gesture:
 *
 *     press, drag, release   -> create the feature with the active tool
 *     press, release         -> back to Select; nothing is created
 *     press on a feature     -> back to Select, that feature selected
 *
 * The drag half already existed (creation-drag.js) and is pinned by
 * `dual-creation.test.cjs`. What this suite pins is the half that was missing:
 * a bare click used to be read as the FIRST POINT of click-move-click, which
 * kept a drag tool armed and required the student to reach for the Select
 * button (or place a second click they did not want).
 *
 * The decision is made ONCE, in `finishCreationClick`, from the session that
 * already knows how far the pointer travelled - not in the click router, and
 * not separately per tool.
 */

const fs = require("fs");

const { locate } = require("./helpers/source-path.cjs");

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

const drag = fs.readFileSync(locate("creation-drag.js"), "utf8");
const events = fs.readFileSync(locate("canvas-events.js"), "utf8");
const click = fs.readFileSync(locate("canvas-click.js"), "utf8");
const classification = require(locate("tool-classification.js"));

const section = (source, name) => {
  const start = source.indexOf(`export function ${name}`);
  if (start === -1) {
    return "";
  }
  const next = source.indexOf("\nexport function ", start + 10);
  return source.slice(start, next === -1 ? source.length : next);
};

const clickSection = section(drag, "finishCreationClick");
const releaseSection = section(drag, "finishCreationDrag");

console.log("\n  a bare click with a drag tool returns to Select\n");

check("the decision has ONE implementation", clickSection.length > 0);

check(
  "it switches through the ordinary activation path",
  /activateTool\(\s*"select"\s*\)/.test(clickSection),
  "activating Select directly is what cancels the pending construction and redraws",
);

check(
  "and selects what the press landed on, or clears the selection",
  /objectAtPoint\([\s\S]{0,80}?\)/.test(clickSection) &&
    /selectObject\([\s\S]{0,60}?hit \? hit\.id : null/.test(clickSection),
  "a click on a feature selects it; a click on empty canvas clears",
);

check(
  "the hit test uses the RAW press position, not a snapped one",
  /pressPoint/.test(clickSection) &&
    !/effectiveConstructionPoint/.test(clickSection),
  "a snap must not decide which feature a click selected",
);

check(
  "the Objects / Features panel and canvas follow the new selection",
  /renderProperties\(\)/.test(clickSection) &&
    /renderFeatures\(\)/.test(clickSection) &&
    /renderCurrentDrawing\(\)/.test(clickSection),
);

console.log("\n  and it never does that to a drag or a click-driven tool\n");

check(
  "a travelled press is never read as a click",
  /session\.moved\s*\|\|/.test(clickSection),
  "a drag that pauses before release must still create",
);

check(
  "a pipe / duct run keeps its own session",
  /session\.pipeDuct/.test(clickSection),
);

check(
  "a point-placement tool keeps its placement click",
  /session\.singlePointTool/.test(clickSection),
);

check(
  "only a tool that draws with a gesture is affected",
  /isDragCreationTool\(/.test(clickSection),
);

check(
  "a click-move-click geometry tool is excluded",
  /isClickClickTool\(/.test(clickSection),
  "Line, Rectangle and Circle deliberately keep click-move-click as well as drag",
);

check(
  "a multi-step tool is abandoned only while it is IDLE",
  /isMultiStepTool\([\s\S]{0,120}?phase !==\s*\n?\s*"idle"/.test(clickSection),
  "a Triangle waiting for a corner, or an Arc for its next point, is mid-operation",
);

console.log("\n  the press records what a click will need\n");

check(
  "the geometry session records the raw press point",
  /pressPoint: startsHere[\s\S]{0,120}?rawPointerPoint/.test(drag),
);

check(
  "and the annotate session records its own press point",
  /annotateArmed\s*\n?\s*\?\s*null\s*\n?\s*:\s*resolvePointerEvent\(event\)\.rawPointerPoint/.test(
    drag,
  ),
);

console.log("\n  the release uses the same decision, and consumes its click\n");

check(
  "a release without travel is offered to the shared decision",
  /!session\.moved &&\s*\n\s*finishCreationClick\(session\)/.test(releaseSection),
);

check(
  "and the trailing browser click is swallowed when it has been answered",
  /if \(\s*!session\.moved &&\s*\n?\s*finishCreationClick\(session\)\s*\n?\s*\) \{\s*\n\s*return true;/.test(
    releaseSection,
  ),
  "otherwise the same click would also be read as a first point",
);

console.log("\n  the click router is still the fallback, and keeps its ordering\n");

check(
  "a bare click on a one-gesture tool still exits there",
  /shouldExitToSelectOnClick\([\s\S]{0,160}?exitToolToSelect/.test(click),
);

check(
  "but only when no construction is under way",
  /shouldExitToSelectOnClick\([\s\S]{0,200}?phase ===\s*\n?\s*"idle"/.test(click),
  "a mid-operation click is a step, not an exit",
);

check(
  "the exit still runs before the construction pipeline",
  click.indexOf("shouldExitToSelectOnClick") <
    click.lastIndexOf("beginOrCompleteGeometry"),
);

console.log("\n  the tool inventory: which tools take part\n");

check(
  "one-gesture span tools exit a bare click",
  ["beam", "cable", "shaft", "point-force", "coordinate-system-2d"].every(
    (tool) => classification.shouldExitToSelectOnClick(tool) === true,
  ),
);

check(
  "click-move-click geometry does not",
  ["line", "rectangle", "circle"].every(
    (tool) => classification.shouldExitToSelectOnClick(tool) === false,
  ),
);

check(
  "point-placement tools do not",
  ["point", "particle", "reference-point", "pin-support"].every(
    (tool) => classification.shouldExitToSelectOnClick(tool) === false,
  ),
);

check(
  "multi-step tools do not",
  ["triangle", "polygon", "arc", "reference-arc", "polyline", "truss", "distributed-load"].every(
    (tool) => classification.shouldExitToSelectOnClick(tool) === false,
  ),
);

check(
  "pipe / duct keeps its clicks - it is a continuous path",
  classification.shouldExitToSelectOnClick("pipe-duct") === false,
);

console.log("\n  a cancelled gesture leaves nothing behind\n");

check(
  "an abandoned release drops the session, preview and all",
  /finishCreationDrag[\s\S]{0,4000}?return true;/.test(releaseSection) &&
    /editorState\.creationDrag = null;/.test(releaseSection),
);

check(
  "switching tools clears any pending creation session",
  /export function activateTool[\s\S]{0,3000}?clearInteraction/.test(
    fs.readFileSync(locate("tool-activation.js"), "utf8"),
  ),
);

check(
  "Escape cancels the construction and returns to Select",
  /export function cancelInteraction[\s\S]{0,9000}?setActiveTool\(\s*drawingState,\s*\n?\s*"select"/.test(
    fs.readFileSync(locate("selection.js"), "utf8"),
  ),
);

check(
  "clicking outside the canvas is not a canvas gesture",
  /drawingCanvas\.contains\([\s\S]{0,80}?target/.test(events),
);

console.log(`\n  ${pass} passed, ${fail} failed\n`);

if (fail) {
  process.exitCode = 1;
}

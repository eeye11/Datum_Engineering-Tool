/*
 * ========================================================
 * BOTH CREATION INTERACTIONS, AT THE LEVEL OF THE DECISION
 * ========================================================
 *
 * The click-vs-drag question is answered in one small place, and it is worth
 * testing directly: the harness cannot reliably deliver pointer events to the
 * canvas, but the DECISION is pure logic.
 *
 * THE BUG THIS PINS DOWN. The press started the feature AND armed a drag
 * session, and the release completed it unconditionally - so a plain CLICK was
 * completed on release AT ITS OWN START POINT. A zero-length line, committed,
 * before the student had moved. Click-move-click was therefore impossible:
 * every first click created something.
 *
 * The gesture is now classified on release by how far the pointer travelled.
 */

const fs = require("fs");

const { modulePath } = require("./helpers/source-path.cjs");

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

const drag = fs.readFileSync(modulePath("creation-drag.js"), "utf8");
const events = fs.readFileSync(modulePath("canvas-events.js"), "utf8");

console.log("\n  the gesture is classified by how far the pointer moved\n");

check(
  "the press records where it landed",
  /startScreen:\s*\{[\s\S]{0,120}x: event\.clientX[\s\S]{0,80}y: event\.clientY/.test(
    drag,
  ),
  "without a start there is nothing to measure travel against",
);

check(
  "and a movement threshold decides click from drag",
  /const DRAG_THRESHOLD_PX = \d+;/.test(drag) &&
    /Math\.hypot\(dx, dy\)[\s\S]{0,40}DRAG_THRESHOLD_PX/.test(drag),
  "a couple of pixels of tremor must still count as a click",
);

check(
  "the threshold is a few pixels, not zero and not large",
  (() => {
    const m = drag.match(/DRAG_THRESHOLD_PX = (\d+)/);
    const value = m ? Number(m[1]) : -1;
    return value >= 2 && value <= 10;
  })(),
  "zero would make every click a drag; a large value would make a short drag need a second click",
);

console.log("\n  a CLICK does not commit, and is not swallowed\n");

check(
  "release WITHOUT travel returns without committing",
  /if \(!session\.moved\) \{\s*\n\s*return false;/.test(drag),
  "this is the first click of click-move-click - it must leave the tool waiting",
);

check(
  "and the press leaves the construction untouched until it moves",
  (() => {
    const at = drag.indexOf("const startsHere =");
    const body = drag.slice(at, at + 700);
    return (
      /pressResolution: startsHere/.test(body) &&
      !/beginOrCompleteGeometry/.test(body)
    );
  })(),
  "starting on the press made one click commit a zero-length feature",
);

check(
  "the deferred start happens on the first movement past the threshold",
  /if \(!session\.moved\)[\s\S]{0,600}session\.moved = true;[\s\S]{0,2000}beginOrCompleteGeometry\(\s*\n\s*session\.pressResolution/.test(
    drag,
  ),
  "the drag must build from the PRESS's point, not the moved-to point",
);

check(
  "a geometric ANNOTATE tool also begins its anchor on the first movement",
  /session\.annotateTool &&[\s\S]{0,400}beginAnnotateDragAnchor\(/.test(drag),
  "a dragged leader must begin its anchor from the press, like a Line",
);

check(
  "a release that never moved returns FALSE, so the trailing click is NOT consumed",
  (() => {
    const start = drag.indexOf("export function finishCreationDrag");
    const at = drag.indexOf("if (!session.moved) {", start);
    const body = drag.slice(at, at + 80);
    return at > 0 && /return false;/.test(body);
  })(),
  "consuming it would swallow the very click that is the first point",
);

check(
  "the construction is left holding its start point",
  !/if \(!session\.moved\) \{[\s\S]{0,200}clearInteraction/.test(drag),
  "the preview must keep following the cursor after the click",
);

console.log("\n  a DRAG commits at the release, and is swallowed\n");

check(
  "release WITH travel completes the feature",
  /if \(\s*DRAG_CONTINUE_PHASES\.includes\(\s*drawingState\.interaction\.phase\s*\)\s*\)\s*\{\s*beginOrCompleteGeometry\(/.test(
    drag,
  ),
);

check(
  "and returns TRUE, so the trailing click is dropped",
  (() => {
    const at = drag.indexOf("if (!session.moved) {");
    const tail = drag.slice(at);

    /* The only `return true` in finishCreationDrag comes at its end. */
    return /return true;/.test(tail);
  })(),
  "without this the release would also start a fresh construction",
);

check(
  "the release point is resolved through the SAME snapping pipeline",
  /beginOrCompleteGeometry\(\s*resolvePointerEvent\(event\)\s*\)/.test(drag),
  "a snap committed must be the snap that was previewed",
);

console.log("\n  both workflows share one pipeline\n");

check(
  "the press uses the ordinary construction entry point",
  /if \(session\.pressResolution\) \{\s*\n\s*beginOrCompleteGeometry\(\s*\n\s*session\.pressResolution/.test(
    drag,
  ),
  "no second geometry path exists for dragging",
);

check(
  "so the same factory, snapping and undo apply to both",
  !/geometryFactories/.test(drag) && !/commitDrawingChange/.test(drag),
  "a module that built geometry itself would be a second implementation",
);

console.log("\n  the pointer is tracked, and a cancelled gesture releases\n");

check(
  "the pointermove path reports travel",
  /moveCreationDrag\(event\)/.test(events),
);

check(
  "and a cancelled pointer clears the press",
  /"pointercancel"[\s\S]{0,200}creationDrag = null/.test(events),
  "otherwise the next release would complete an abandoned gesture",
);

console.log("\n  a press on existing geometry is DEFERRED, not refused\n");

/*
 * THE PRESS IS NO LONGER REFUSED. It used to return early, which meant a drag
 * that started on a beam could not begin a feature at all - the new member
 * only appeared once the cursor had left the geometry. The press is armed now
 * and the DECISION is deferred to the gesture: a click on the feature still
 * selects it, while a drag lets the active tool start from the pressed point.
 */
check(
  "the press on an existing feature is NOTED, not refused",
  /const onExisting =\s*idle &&\s*pressSelectsExistingObject\(event\)/.test(
    drag,
  ),
  "refusing the press is what stopped a drag from starting on a beam",
);

check(
  "and it is no longer an early return",
  !/if \(\s*idle &&\s*pressSelectsExistingObject\(event\)\s*\)\s*\{\s*return false;/.test(
    drag,
  ),
  "a click is still a selection, but that is decided on release",
);

console.log(`\n  ${pass} passed, ${fail} failed\n`);

if (fail) {
  process.exitCode = 1;
}

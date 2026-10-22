/*
 * ========================================================
 * THE ROTATION HANDLE TURNS A FEATURE ABOUT A FIXED CENTRE
 * ========================================================
 *
 * Reported on a Rectangle: the handle turned it smoothly for a while, then
 * the shape jumped to a random angle and its centre was no longer kept.
 *
 * THE CAUSE
 * ---------
 * The rotate drag read the cursor through the construction snap pipeline,
 * so the point it measured the angle from was pulled onto grid points, the
 * rectangle's own corners and centre, and horizontal/vertical guides. Each
 * snap was a jump in angle unrelated to the hand, and a snap onto the pivot
 * itself made the angle undefined. The pivot was also re-derived every frame
 * from the half-turned live shape instead of being fixed at the grab.
 *
 * Two halves are pinned here:
 *
 *   1. BEHAVIOUR - turning a rectangle from its snapshot, frame after frame,
 *      through every angle, never moves its centre or changes its size.
 *   2. STRUCTURE - the drag code itself needs a live canvas, so (like
 *      drag-undo.test.cjs) the shape of the fix is pinned in the source:
 *      raw pointer, pivot captured once, a dead zone at the pivot, and the
 *      Shift angle step.
 */
const fs = require("fs");

const { modulePath, locate } = require("./helpers/source-path.cjs");

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

const geometryModule = require(modulePath("feature-geometry.js"));
const geometry = geometryModule.default || geometryModule;

console.log("\n  turning a rectangle frame by frame\n");

const original = {
  type: "rectangle",
  geometry: { position: { x: 10, y: 40 }, width: 60, height: 25, rotation: 0 }
};

const centreOf = (object) => geometry.centerOf(object.geometry, object.type);
const pivot = centreOf(original);

let worstDrift = 0;
let worstSize = 0;

/*
 * Exactly as the drag does it: every frame starts again from the snapshot
 * and applies the whole turn so far, about the pivot captured at the grab.
 * Sweeps several full turns in both directions, past the 0/360 wrap.
 */
for (let step = -1440; step <= 1440; step += 7) {
  const live = JSON.parse(JSON.stringify(original));
  geometry.rotateObjectAbout(live, pivot, (step * Math.PI) / 180);

  const centre = centreOf(live);
  worstDrift = Math.max(worstDrift, Math.hypot(centre.x - pivot.x, centre.y - pivot.y));
  worstSize = Math.max(
    worstSize,
    Math.abs(live.geometry.width - 60),
    Math.abs(live.geometry.height - 25)
  );
}

check("the centre never moves", worstDrift < 1e-9, `drifted by ${worstDrift}`);
check("the width and height never change", worstSize < 1e-9, `changed by ${worstSize}`);

{
  const live = JSON.parse(JSON.stringify(original));
  geometry.rotateObjectAbout(live, pivot, Math.PI / 4);
  check(
    "a 45 degree turn stores 45 degrees",
    Math.abs(live.geometry.rotation - 45) < 1e-9,
    `stored ${live.geometry.rotation}`
  );
}

console.log("\n  the drag code\n");

const drag = fs.readFileSync(locate("drag.js"), "utf8");

const updateStart = drag.indexOf("export function updateManipulationDrag");
const update = drag.slice(updateStart, drag.indexOf("export function finishManipulationDrag"));

check(
  "a rotate drag reads the raw pointer, not the snap pipeline",
  /const rotating\s*=\s*editorState\.manipulationDrag\.kind === "rotate"/.test(update) &&
    /kind === "body" \|\| rotating\s*\?\s*\{ rawPointerPoint: canvasPointFromEvent\(event, false\)/.test(update),
  "the rotation point still goes through resolveManipulationPoint"
);

check(
  "the pivot is captured once, at the grab",
  /rotationPivot:\s*hit\.handle\.kind === "rotate"\s*\?\s*rotationPivotFor\(hit\.object\)/.test(drag),
  "no rotationPivot on the drag session"
);

const rotateStart = drag.indexOf('if (drag.kind === "rotate")');
const rotate = drag.slice(rotateStart, drag.indexOf('if (drag.kind === "body"', rotateStart));

check(
  "and the rotation uses that pivot",
  /drag\.rotationPivot\s*\|\|/.test(rotate),
  "the pivot is re-derived from the live shape each frame"
);

check(
  "a pointer on the pivot keeps the last rotation",
  /ROTATION_DEAD_ZONE_PX/.test(rotate),
  "no dead zone around the pivot"
);

check(
  "Shift turns in 15 degree steps",
  /const ROTATION_STEP = Math\.PI \/ 12;/.test(drag) && /drag\.shiftKey[\s\S]{0,120}ROTATION_STEP/.test(rotate),
  "no Shift angle step"
);

console.log(`\n  ${pass} passed, ${fail} failed\n`);

if (fail) {
  process.exitCode = 1;
}

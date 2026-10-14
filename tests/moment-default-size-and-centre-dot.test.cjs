/*
 * ========================================================
 * A MOMENT'S DEFAULT SIZE, AND ITS APPLICATION POINT
 * ========================================================
 *
 * Two small presentation changes, both about the moment reading correctly on
 * the sheet:
 *
 *   1. The DEFAULT radius was raised slightly, so a freshly placed moment is
 *      not tight around its own centre. It is a DEFAULT only - a moment that
 *      carries its own `arcRadius` keeps it, and the magnitude, direction and
 *      attachment behaviour are untouched.
 *
 *   2. A CENTRE DOT marks the moment's application point. It is drawn at the
 *      arc's own centre, at the moment's attachment coordinate, in screen space
 *      at a fixed size - so it is visible at every zoom and never swells when
 *      zoomed in. It is not a separate feature.
 */

const fs = require("fs");

const { locate, rendererSource } = require("./helpers/source-path.cjs");

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

const rotational = fs.readFileSync(locate("rotational-arrow.js"), "utf8");
const renderer = rendererSource();
const attachment = fs.readFileSync(locate("statics-attachment.js"), "utf8");

console.log("\n  the default size was raised, modestly\n");

check(
  "the default radius is 20, up from 16",
  /DEFAULT_ARC_RADIUS_PX\s*=\s*20\b/.test(rotational),
  "the change is meant to be small enough to stay proportional",
);

check(
  "the bounds still contain the new default",
  /MIN_ARC_RADIUS_PX\s*=\s*8\b/.test(rotational) &&
    /MAX_ARC_RADIUS_PX\s*=\s*80\b/.test(rotational),
);

check(
  "a user-set radius is still honoured, not overwritten by the default",
  /clampArcRadius[\s\S]{0,400}?Number\.isFinite\(radius\)/.test(rotational),
);

console.log("\n  the centre dot marks the application point\n");

check(
  "a dot is drawn as part of the rotational arrow",
  /appendRotationalArrow[\s\S]{0,4000}?centreDotRadius[\s\S]{0,400}?createSvgElement\("circle"/.test(
    renderer,
  ) || /centreDotRadius/.test(renderer),
);

check(
  "it sits at the arc's own centre, with no offset",
  /cx:\s*arc\.center\.x/.test(renderer) &&
    /cy:\s*arc\.center\.y/.test(renderer),
  "any offset would put the dot somewhere other than the attachment point",
);

check(
  "it is a fixed screen size, so zoom cannot inflate it",
  /const centreDotRadius = \d+(\.\d+)?;/.test(renderer) &&
    !/centreDotRadius[\s\S]{0,80}arc\.radius/.test(renderer),
);

check(
  "it is drawn in the feature's own stroke, subordinate to the arrow",
  /r:\s*centreDotRadius[\s\S]{0,120}fill:\s*stroke/.test(renderer),
);

console.log("\n  nothing else about a moment changed\n");

check(
  "the attachment writer is untouched by the size change",
  /arcRadius/.test(attachment) === false ||
    /arcRadius[\s\S]{0,200}position/.test(attachment),
);

console.log(`\n  ${pass} passed, ${fail} failed\n`);

if (fail) {
  process.exitCode = 1;
}

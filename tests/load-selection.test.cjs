
const { JSDOM } = require("jsdom");

const path = require("path");

const { loadModule, locate, modulePath, sourceDir } = require("./helpers/source-path.cjs");
/*
 * ========================================================
 * CAN THE SELECT TOOL REACH A DISTRIBUTED LOAD?
 * ========================================================
 *
 * A distributed load is drawn as a field: a row of arrows standing off the
 * body along its normal, closed by an envelope. Almost none of that ink is
 * near the two points the model stores, so a hit test that looks near those
 * points - which is what every other feature gets - catches almost nothing.
 *
 * The symptom was that clicking a load selected whatever was behind it. For
 * a uniform load the biggest, most obvious target on the screen is the
 * envelope - a rectangle sitting clear of the beam - and clicking the
 * middle of it was the one click a student is guaranteed to try.
 *
 * Three things are drawn and all three must be hittable:
 *
 *   1. an arrow shaft
 *   2. the envelope, from inside and just outside its edge
 *   3. the body line between the two stations
 *
 * And the arrow length used to test them has to be the one the RENDERER
 * draws with - the load's drawn height for each intensity, in world units -
 * or the hit region drifts away from the ink.
 */


const projectRoot = path.join(__dirname, "..");

let pass = 0;
let fail = 0;

const check = (name, ok, detail) => {
  if (ok) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(
      `  FAIL ${name}${detail ? `\n       ${detail}` : ""}`,
    );
  }
};

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  pretendToBeVisual: true,
});

global.window = dom.window;
global.document = dom.window.document;

loadModule("load-profile.js");

const profile = global.window.enggLoadProfile;

/*
 * The hit test works in WORLD units, like the body and the point it is given.
 * (It used to take pixels-per-unit and the Vector Scale and lay a screen
 * length along a world-space body, so the clickable field grew with zoom.)
 */
const hits = (geometry, point, tolerance = 1) =>
  profile.loadContainsPoint(
    geometry,
    point,
    tolerance,
  );

/*
 * A 10 kN/m load over 100 mm, hanging below a level beam and pushing down.
 * The normal is -y, so the arrows stand below the body.
 */
const uniform = () => ({
  start: { x: 0, y: 0 },
  end: { x: 100, y: 0 },
  intensity: 10,
  direction: -90,
  interval: 20,
  normalSide: -1,
  points: [
    { t: 0, magnitude: 10 },
    { t: 1, magnitude: 10 }
  ],
});

/*
 * How far the arrows actually reach, from the module the renderer uses.
 * Read rather than assumed, so the test cannot drift from the drawing.
 */
const reach = geometry =>
  profile.loadArrowReach(geometry, profile.peakMagnitude(geometry));

console.log("\n  an arrow is hittable\n");

const load = uniform();

const arrowReach = reach(load);

check(
  "the arrows stand off the body",
  arrowReach > 1,
  `reach was ${arrowReach}`,
);

check(
  "a point on the first arrow's shaft is a hit",
  hits(
    load,
    { x: 0, y: -arrowReach / 2 },
  ),
);

check(
  "a point on the middle arrow's shaft is a hit",
  hits(
    load,
    { x: 50, y: -arrowReach / 2 },
  ),
);

check(
  "a point on the last arrow's shaft is a hit",
  hits(
    load,
    { x: 100, y: -arrowReach / 2 },
  ),
);

console.log("\n  and so is the envelope, which is the obvious target\n");

/*
 * THE CASE THAT WAS BROKEN. The middle of the envelope is clear of the body
 * by the arrow length, so no "near the stored points" test can reach it.
 */
check(
  "the middle of the envelope is a hit",
  hits(
    load,
    { x: 50, y: -arrowReach * 0.5 },
  ),
  `reached ${arrowReach.toFixed(1)}, tested at ${(arrowReach * 0.5).toFixed(1)}`,
);

check(
  "a point just inside the top edge is a hit",
  hits(
    load,
    { x: 50, y: -arrowReach + 0.5 },
  ),
);

check(
  "a point just outside the top edge is still a hit, within tolerance",
  hits(
    load,
    { x: 50, y: -arrowReach - 0.5 },
  ),
  "clicking just past the edge should not select the beam behind",
);

console.log("\n  and clear air well beyond it is not\n");

check(
  "far above the load is a miss",
  !hits(
    load,
    { x: 50, y: arrowReach + 50 },
  ),
);

check(
  "far beyond the far end is a miss",
  !hits(
    load,
    { x: 300, y: 0 },
  ),
);

check(
  "far below the envelope is a miss",
  !hits(
    load,
    { x: 50, y: -arrowReach - 50 },
  ),
);

console.log("\n  the body line between the stations is hittable\n");

check(
  "the body line is a hit",
  hits(load, { x: 50, y: 0 }),
);

console.log("\n  a tapered load is hittable too\n");

/*
 * The varying load stores an intensity at each end rather than a profile of
 * points, so it has to be converted before anything can be measured against
 * it. It was falling through to a test for `start` and `end` that it does
 * not have, so it could not be clicked at all.
 */
const tapered = {
  start: { x: 0, y: 0 },
  end: { x: 100, y: 0 },
  direction: -90,
  startIntensity: 0,
  endIntensity: 20
};

const profile_ = profile.drawnProfile(tapered);

check(
  "a varying load has a drawn profile",
  profile_ &&
    Array.isArray(profile_.points) &&
    profile_.points.length === 2,
  `points: ${JSON.stringify(profile_?.points)}`,
);

check(
  "whose end intensities are the intensities",
  profile_ &&
    profile_.points[0].magnitude === 0 &&
    profile_.points[1].magnitude === 20,
  `points: ${JSON.stringify(profile_?.points)}`,
);

const taperReach = reach(profile_);

check(
  "the tall end of the taper is hittable",
  hits(
    tapered,
    { x: 100, y: -taperReach / 2 },
    1,
  ) ||
    hits(
      profile_,
      { x: 100, y: -taperReach / 2 },
    ),
);

check(
  "the loaded region of a taper is hittable",
  hits(
    profile_,
    { x: 50, y: -5 },
  ),
);

console.log("\n  the hit region follows the DRAWN height\n");

/*
 * The arrows are as long as the load was drawn (`arrowLength`), so the hit
 * region has to follow the stored height - a fixed length would keep passing
 * for one load and stop matching the drawing for the next.
 */
const tall = { ...uniform(), arrowLength: 30 };

check(
  "a taller drawn load is hittable out to its own height",
  hits(tall, { x: 50, y: -28 }),
);

check(
  "and its intensity did not decide that height",
  profile.loadArrowReach(tall, 10) === 30,
  String(profile.loadArrowReach(tall, 10)),
);

const short = { ...uniform(), arrowLength: 4 };

check(
  "a shorter one is a miss beyond its own height",
  !hits(short, { x: 50, y: -12 }),
);

console.log("\n  and a reversed load is hit in the same place\n");

/*
 * Reversal changes the sense of the arrows and nothing about where they are
 * drawn, so the clickable region must not move. This is the same invariant
 * the outline fix is about, seen from the selection side.
 */
const reversed = uniform();

profile.reverseLoadDirection(reversed);

check(
  "the reversal is recorded",
  reversed.reversed === true,
);

check(
  "the arrows are still hittable",
  hits(
    reversed,
    { x: 50, y: -arrowReach / 2 },
  ),
);

check(
  "the envelope is still hittable",
  hits(
    reversed,
    { x: 50, y: -arrowReach * 0.5 },
  ),
);

console.log(
  `\n${pass} passed, ${fail} failed\n`,
);

if (fail) {
  process.exitCode = 1;
}

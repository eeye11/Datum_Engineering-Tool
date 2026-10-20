
const path = require("path");

const { loadModule, locate, modulePath, sourceDir } = require("./helpers/source-path.cjs");
/*
 * IS THE RESULTANT THE ACTUAL RESULTANT?
 *
 * Reported: a resultant that "creates a tiny vector in the correct
 * relative direction" - right way round, far too small to mean anything -
 * and a resultant that does not update when its source forces change.
 *
 * The size half of that was real. `drawnLength` returned a FIXED 30 units
 * with only the direction taken from the sum, so a resultant of 250 N and
 * one of 5 N drew identically: the drawing could not show that one was
 * fifty times the other, which is the whole reason for drawing a
 * resultant next to the forces it comes from.
 *
 * So this file checks the size, and - just as importantly - the DIRECTION,
 * because scaling a vector wrongly is easy: multiplying x and y by the
 * same factor preserves the direction and multiplying them differently
 * does not. A resultant drawn at the wrong angle with the right length
 * would pass a magnitude check.
 */

global.window = { crypto: { randomUUID: () => "resultant-uuid" } };

loadModule("load-profile.js");
loadModule("feature-geometry.js");
loadModule("body-frames.js");
loadModule("analysis-dependencies.js");
loadModule("drawing-state.js");

const deps = global.window.enggAnalysisDependencies;
const state = global.window.enggDrawingState;

let pass = 0;
let fail = 0;

const check = (name, ok, detail) => {
  if (ok) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(
      `  FAIL ${name}${detail ? `\n       ${detail}` : ""}`
    );
  }
};

const near = (a, b) =>
  Number.isFinite(a) && Math.abs(a - b) < 1e-9;

/*
 * A force as the application stores one: drawn as an arrow along its angle,
 * and stating a value. The arrow is drawn a TENTH of the value long here, so
 * nothing below can pass by confusing the two.
 */
const force = (id, magnitude, angleDegrees, drawnLength = magnitude / 10) => {
  const radians = angleDegrees * Math.PI / 180;

  return {
    id,
    type: "force",
    geometry: {
      start: { x: 0, y: 0 },
      end: { x: Math.cos(radians) * drawnLength, y: Math.sin(radians) * drawnLength },
      position: { x: 0, y: 0 },
      magnitude,
      angle: angleDegrees
    }
  };
};

const drawingFor = sources => ({
  objects: sources,
  selection: { selectedObjectIds: [] },
  interaction: { phase: "idle" }
});

console.log("\n  the resultant is the sum, at the sum's size\n");

/* ============================================================
   THE MAGNITUDE IS THE SUM
   ============================================================ */

const a = force("f-a", 300, 0);
const b = force("f-b", 400, 90);

const together = deps.deriveResultant([a, b]);

check(
  "300 N along x plus 400 N along y is 300 by 400",
  together && near(together.x, 300) && near(together.y, 400),
  `got ${together && together.x}, ${together && together.y}`
);

check(
  "the magnitude of that sum is 500 N",
  together && near(together.magnitude, 500),
  `got ${together && together.magnitude}`
);

check(
  "the angle of that sum is 53.13 degrees",
  together && near(together.angle, Math.atan2(400, 300) * 180 / Math.PI),
  `got ${together && together.angle}`
);

/*
 * OPPOSING FORCES, WHICH IS WHERE A SUM GOES WRONG.
 *
 * Two equal and opposite forces have a resultant of zero, and zero is a
 * real answer - not a degenerate one. A tool that reports a small
 * non-zero vector for a balanced system would be claiming a residual
 * force the student knows does not exist.
 */
const balanced = deps.deriveResultant([
  force("f-c", 250, 0),
  force("f-d", 250, 180)
]);

check(
  "two equal and opposite forces sum to zero",
  balanced && near(balanced.magnitude, 0),
  `got ${balanced && balanced.magnitude}`
);

/* ============================================================
   THE ARROW FOLLOWS THE DRAWING; THE VALUE IS THE SUM
   ============================================================ */

console.log("\n  the resultant is drawn from the drawn arrows\n");

/*
 * THE CONTRACT. A resultant STATES the engineering sum - its magnitude and
 * components - and is DRAWN as the sum of its sources' drawn arrows, tip to
 * tail, the way the student would construct it on the sheet. (A shared Vector
 * Scale used to draw it at magnitude x scale; it is retired, and no value ever
 * sets an arrow's length.)
 *
 * The sources here are drawn at a tenth of their values: 300 N as 30 long
 * along x, 400 N as 40 long along y.
 */
const resultant = state.geometryFactories.resultant(
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  {}
);

deps.registerDependency(resultant, ["f-a", "f-b"]);

const drawing = drawingFor([a, b, resultant]);

deps.refreshAnalysis(resultant, drawing, null);

const drawnX = resultant.geometry.end.x - resultant.geometry.start.x;
const drawnY = resultant.geometry.end.y - resultant.geometry.start.y;

check(
  "the stored magnitude is the true resultant",
  near(resultant.geometry.magnitude, 500),
  `stored ${resultant.geometry.magnitude}`
);

check(
  "the stored components are the true sums",
  near(resultant.geometry.forceX, 300) &&
    near(resultant.geometry.forceY, 400),
  `(${resultant.geometry.forceX}, ${resultant.geometry.forceY})`
);

check(
  "the drawn arrow is the sum of the drawn arrows",
  near(drawnX, 30) && near(drawnY, 40),
  `drawn (${drawnX}, ${drawnY}), expected (30, 40)`
);

check(
  "and it is drawn at a visible length, not a stub",
  Math.hypot(drawnX, drawnY) > 1,
  `drawn ${Math.hypot(drawnX, drawnY)} units`
);

check(
  "the drawn arrow points the same way as the sum",
  near(Math.atan2(drawnY, drawnX) * 180 / Math.PI, resultant.geometry.angle),
  `drawn ${Math.atan2(drawnY, drawnX) * 180 / Math.PI}, stored ${resultant.geometry.angle}`
);

console.log("\n  a value never sizes the arrow\n");

/*
 * The same arrows stating twice the values: the resultant's VALUE doubles and
 * its drawn arrow does not move.
 */
{
  const doubled = [force("f-a", 600, 0, 30), force("f-b", 800, 90, 40)];
  const bigger = state.geometryFactories.resultant({ x: 0, y: 0 }, { x: 1, y: 0 }, {});

  deps.registerDependency(bigger, ["f-a", "f-b"]);
  deps.refreshAnalysis(bigger, drawingFor([...doubled, bigger]), null);

  check(
    "twice the values is twice the stated resultant",
    near(bigger.geometry.magnitude, 1000),
    `stored ${bigger.geometry.magnitude}`
  );

  check(
    "and the same drawn arrow",
    near(bigger.geometry.end.x - bigger.geometry.start.x, 30) &&
      near(bigger.geometry.end.y - bigger.geometry.start.y, 40),
    `drawn (${bigger.geometry.end.x - bigger.geometry.start.x}, ${bigger.geometry.end.y - bigger.geometry.start.y})`
  );
}

/*
 * ...and drawing a source longer draws the resultant longer, with no value
 * changed: the geometry follows the drawing.
 */
{
  const redrawn = [force("f-a", 300, 0, 60), force("f-b", 400, 90, 40)];
  const followed = state.geometryFactories.resultant({ x: 0, y: 0 }, { x: 1, y: 0 }, {});

  deps.registerDependency(followed, ["f-a", "f-b"]);
  deps.refreshAnalysis(followed, drawingFor([...redrawn, followed]), null);

  check(
    "a source drawn longer draws the resultant longer",
    near(followed.geometry.end.x - followed.geometry.start.x, 60),
    `drawn x ${followed.geometry.end.x - followed.geometry.start.x}`
  );

  check(
    "while the stated resultant is unchanged",
    near(followed.geometry.magnitude, 500),
    `stored ${followed.geometry.magnitude}`
  );
}

/* ============================================================
   IT FOLLOWS ITS FORCES
   ============================================================ */

console.log("\n  it follows its forces\n");

a.geometry.magnitude = 600;

deps.refreshAnalysis(resultant, drawing, null);

/*
 * 600 N along x plus 400 N along y. The magnitude is the hypotenuse of
 * those, which is about 721 N - NOT 700, and not 1000: an early version of
 * this check expected a round number the arithmetic has no reason to
 * produce, and "failed" on correct behaviour.
 */
check(
  "changing a source force changes the resultant",
  near(resultant.geometry.magnitude, Math.hypot(600, 400)),
  `expected ${Math.hypot(600, 400)}, got ${resultant.geometry.magnitude}`
);

check(
  "the new sum is used in full",
  near(resultant.geometry.forceX, 600) &&
    near(resultant.geometry.forceY, 400),
  `(${resultant.geometry.forceX}, ${resultant.geometry.forceY})`
);

/*
 * A FORCE TURNED END OVER END. Flipping a force must change the
 * resultant, not merely move the drawing - and the reported fault was a
 * resultant that kept pointing the way it did when its sources were
 * re-aimed.
 *
 * 400 N at 270 degrees is 400 straight down, so the sum of 600 right and
 * 400 down is the same length as before but in a different direction. A
 * magnitude-only check would find this identical to the previous state and
 * call it unchanged, so the COMPONENTS are checked as well.
 */
b.geometry.angle = 270;

deps.refreshAnalysis(resultant, drawing, null);

check(
  "re-aiming a source force changes the resultant's direction",
  near(resultant.geometry.forceX, 600) &&
    near(resultant.geometry.forceY, -400),
  `(${resultant.geometry.forceX}, ${resultant.geometry.forceY})`
);

check(
  "and its magnitude is unchanged, because the two are still orthogonal",
  near(resultant.geometry.magnitude, Math.hypot(600, 400)),
  `got ${resultant.geometry.magnitude}`
);

/*
 * A FORCE THAT SAYS NOTHING. It must not silently contribute zero, which
 * would be a claim the student never made.
 *
 * Only the MAGNITUDE is checked. An earlier version also asserted a
 * `usedSources` count on the object, and that failed - the derivation
 * reports how many sources it used, but refreshResultant does not copy
 * that count onto the feature, so the assertion was asking for something
 * the model does not keep. Asking for it here would have been inventing a
 * requirement, and "fixing" the app to satisfy a test nobody asked for.
 */
b.geometry.magnitude = "not a number";

deps.refreshAnalysis(resultant, drawing, null);

check(
  "an unfinished force contributes nothing, and the other still counts",
  near(resultant.geometry.magnitude, 600),
  `magnitude ${resultant.geometry.magnitude}`
);

check(
  "and the sum is the one force that did describe itself",
  near(resultant.geometry.forceX, 600) &&
    near(resultant.geometry.forceY, 0),
  `(${resultant.geometry.forceX}, ${resultant.geometry.forceY})`
);

console.log(
  `\n  ${pass} passed, ${fail} failed\n`
);

if (fail) {
  process.exitCode = 1;
}

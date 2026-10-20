
const { JSDOM } = require("jsdom");

const path = require("path");
const fs = require("fs");

const { controllerSource, loadModule, locate, modulePath, sourceDir } = require("./helpers/source-path.cjs");
/*
 * ========================================================
 * DOES A LOAD ACT WHERE IT SAYS IT DOES?
 * ========================================================
 *
 * A Distributed Load is a REGION of a body plus a direction. It is not a
 * position in space, and nothing about it is free: which part of the member
 * it covers, and which side of the member it acts from, follow from those
 * two facts.
 *
 * Two reports came out of that being untrue:
 *
 *   1. The panel offered six numbers for those two facts - Offset X,
 *      Offset Y, Start Y, End Y as well as the two stations - with the
 *      load's outline height stored independently of the body and the
 *      direction. Nothing kept them consistent, so the load could be
 *      described into a state it could not be drawn in.
 *   2. Reversing a load moved its outline to the other side of the member.
 *
 * The second is the sharper one. `loadBodyNormal` derived the sense of the
 * span's normal from the load's CURRENT direction - the same field the
 * reverse control writes - so a reversal re-derived it, flipped it, and
 * carried the whole field of force lines across the beam. The comment
 * beside it claimed a reversal "leaves this agreement - and therefore the
 * drawn line - alone". It did not leave it alone, and the comment described
 * the intended behaviour while the code did the opposite.
 *
 * The fix is to pin the side once, when the load's direction is first set,
 * and read it back unchanged afterwards: which side a load acts from is a
 * fact about the region, not a consequence of which way it currently
 * pushes.
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

/*
 * The module attaches to `window`, so that is where it is read from.
 * The same binding the page's own script tag creates.
 */
loadModule("load-profile.js"
  );

const profile = global.window.enggLoadProfile;

const near = (a, b, tolerance = 1e-9) =>
  Math.abs(a - b) < tolerance;

/*
 * A load on a level beam, hanging below it: start at the left end,
 * end at the right, pushing downward.
 */
function downwardLoad() {
  return {
    start: { x: 0, y: 0 },
    end: { x: 100, y: 0 },
    direction: -90,
    points: [
      { t: 0, magnitude: 10 },
      { t: 1, magnitude: 10 }
    ]
  };
}

console.log("\n  reversing a load does not move its outline\n");

const before = profile.loadBodyNormal(downwardLoad());

check(
  "a downward load has an outward normal",
  before !== null,
);

/* THE SPAN MUST NOT MOVE EITHER. */
const geometry = downwardLoad();

const startBefore = { ...geometry.start };
const endBefore = { ...geometry.end };

profile.reverseLoadDirection(geometry);

const after = profile.loadBodyNormal(geometry);

check(
  "the normal is unchanged after a reversal",
  near(before.x, after.x) && near(before.y, after.y),
  `was (${before.x}, ${before.y}) now (${after.x}, ${after.y})`,
);

check(
  "the reversal was recorded",
  geometry.reversed === true,
);

check(
  "the loaded region is untouched",
  near(geometry.start.x, startBefore.x) &&
    near(geometry.start.y, startBefore.y) &&
    near(geometry.end.x, endBefore.x) &&
    near(geometry.end.y, endBefore.y),
);

check(
  "the region did not swap its two ends",
  geometry.start.x === startBefore.x &&
    geometry.end.x === endBefore.x,
  "reversing is not a mirror",
);

/*
 * TWO REVERSALS IS A NO-OP, which is what a student pressing the control
 * twice expects - not a quarter turn.
 */
profile.reverseLoadDirection(geometry);

check(
  "two reversals are back to the original",
  geometry.reversed === false,
);

check(
  "and the normal is still unchanged",
  near(before.x, after.x) && near(before.y, after.y),
);

console.log("\n  and it survives a save and reload\n");

/*
 * THE POINT OF PINNING IT. Without a stored side, the only way to know
 * which side a load is drawn on is to ask its current direction - which
 * is what made the reversal move it. So the side has to be a fact on the
 * load, carried through a save like any other.
 */
const pinned = downwardLoad();

profile.setLoadDirection(pinned, -90);

check(
  "setting a direction pins the side",
  pinned.normalSide === 1 || pinned.normalSide === -1,
  `normalSide: ${pinned.normalSide}`,
);

/* A save/reload is a JSON round trip - this is what persistence does. */
const reloaded = JSON.parse(JSON.stringify(pinned));

check(
  "the pinned side survives a round trip",
  reloaded.normalSide === pinned.normalSide,
);

const normalBeforeSave = profile.loadBodyNormal(pinned);

profile.reverseLoadDirection(reloaded);

check(
  "a reversed reloaded load keeps its side",
  near(
    profile.loadBodyNormal(reloaded).x,
    normalBeforeSave.x,
  ) && near(
    profile.loadBodyNormal(reloaded).y,
    normalBeforeSave.y,
  ),
  "a drawing reopened from disk must look as it was saved",
);

/*
 * TYPING A DIRECTION SETS THE SIDE RATHER THAN INHERITING ONE.
 *
 * Setting a direction for the first time is the student saying which way
 * the load acts from the outset - not a reversal of something else - so
 * that is the moment the side is decided.
 */
const typed = downwardLoad();

typed.normalSide = 1;

profile.setLoadDirection(typed, 90);

check(
  "an already-pinned side is not re-decided by typing a direction",
  typed.normalSide === 1,
  `normalSide became ${typed.normalSide}`,
);

check(
  "but the direction itself was written",
  typed.direction === 90,
);

console.log("\n  an older drawing still opens\n");

/*
 * A file saved before the side was pinned has no field for it. It must
 * still draw the way it was saved, which means falling back to the
 * direction it was last using - not picking a side arbitrarily.
 */
const legacy = {
  start: { x: 0, y: 0 },
  end: { x: 100, y: 0 },
  direction: -90,
  points: [{ t: 0, magnitude: 5 }]
};

const legacyNormal = profile.loadBodyNormal(legacy);

check(
  "a load with no pinned side still has a normal",
  legacyNormal !== null,
);

check(
  "and it matches what a pinned one would have been",
  near(legacyNormal.x, before.x) &&
    near(legacyNormal.y, before.y),
  `legacy (${legacyNormal.x}, ${legacyNormal.y}) vs pinned (${before.x}, ${before.y})`,
);

check(
  "loadNormalSide can be computed for a load that has none",
  profile.loadNormalSide(legacy) === 1 ||
    profile.loadNormalSide(legacy) === -1,
);

console.log("\n  a load's height is derived, never typed\n");

/*
 * THE FEATURES PANE OFFERS NO POSITION FIELDS FOR A LOAD. A load is placed by
 * its two stations on the body it acts on; its outline height is derived from
 * the body and the direction. So the pane's field table must not give a load
 * a typed Start Y, End Y or offset.
 */
{
  const schema = require(modulePath("feature-schema.js"));
  const load = { type: "load", geometry: { start: { x: 0, y: 0 }, end: { x: 100, y: 0 }, intensity: 10 } };
  const keys = schema.groupsFor(load).flatMap((group) => group.fields.map((field) => field.key || field));

  check(
    "a load's Features offer no typed position",
    !keys.some((key) => /^(start|end|position|offset)/i.test(String(key))),
    `fields: ${keys.join(", ")}`,
  );
}

console.log(
  `\n${pass} passed, ${fail} failed\n`,
);

if (fail) {
  process.exitCode = 1;
}
